import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SceneEntity } from '@digiworld/shared/scene';

import { apiFetch } from '../../lib/api';
import { resolveSceneModelUrl, DEFAULT_ARENA_MODEL } from '@digiworld/scene3d/arena-urls';
import { updateScene } from '../../lib/api-scenes';

type ProjectDocument = Record<string, unknown> & { readonly scene: object; readonly camera: object };
type EditorMessage = {
  readonly channel: string;
  readonly nonce: string;
  readonly type: string;
  readonly requestId?: string;
  readonly project?: ProjectDocument;
  readonly bytes?: ArrayBuffer;
  readonly message?: string;
};
type UploadResponse = {
  readonly ok: true;
  readonly revision: {
    readonly projectUrl: string;
    readonly modelUrl: string;
    readonly projectSha256: string;
    readonly modelSha256: string;
  };
};
type PendingRequest = { resolve: (message: EditorMessage) => void; reject: (error: Error) => void };

const CHANNEL = 'digiworld.three-editor.v1';
const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const MAX_GLB_BYTES = 128 * 1024 * 1024;

function sceneModelUrl(scene: SceneEntity): string | undefined {
  const modelFile = scene.settings['modelFile'];
  return resolveSceneModelUrl(
    typeof modelFile === 'string' ? modelFile : undefined,
    DEFAULT_ARENA_MODEL,
  );
}

export function ThreeEditorFrame({
  scene,
  onClose,
  onSaved,
}: {
  readonly scene: SceneEntity;
  readonly onClose: () => void;
  readonly onSaved: (scene: SceneEntity) => void;
}): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pending = useRef(new Map<string, PendingRequest>());
  const nextId = useRef(0);
  const dirtyRef = useRef(false);
  const readyRef = useRef(false);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const [nonce] = useState(() => window.crypto.randomUUID());
  const [sceneLoaded, setSceneLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [status, setStatus] = useState('Loading official Three.js Editor…');
  const editorUrl = useMemo(() => `/threejs-editor/?nonce=${encodeURIComponent(nonce)}`, [nonce]);

  const request = useCallback((type: string, payload: Record<string, unknown> = {}): Promise<EditorMessage> => {
    const target = frameRef.current?.contentWindow;
    if (target === null || target === undefined) return Promise.reject(new Error('Editor frame is not available'));
    const requestId = String(++nextId.current);
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error('The editor did not respond in time'));
      }, 120_000);
      pending.current.set(requestId, {
        resolve: (message) => { window.clearTimeout(timeout); resolve(message); },
        reject: (error) => { window.clearTimeout(timeout); reject(error); },
      });
      target.postMessage({ channel: CHANNEL, nonce, type, requestId, ...payload }, window.location.origin);
    });
  }, [nonce]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (typeof event.data !== 'object' || event.data === null) return;
      const message = event.data as Partial<EditorMessage>;
      if (message.channel !== CHANNEL || message.nonce !== nonce || typeof message.type !== 'string') return;

      if (message.type === 'ready') {
        if (readyRef.current) return;
        readyRef.current = true;
        setStatus('Loading scene…');
        const currentScene = sceneRef.current;
        const projectUrl = currentScene.settings['editorProjectFile'];
        const projectUrlIsSafe = typeof projectUrl === 'string'
          && new RegExp(`^/assets/scenes/${currentScene.id}/rev_[a-f0-9]{32}/project\\.app\\.json$`).test(projectUrl);
        const modelUrl = sceneModelUrl(currentScene);
        const payload: Record<string, unknown> = {};
        if (projectUrlIsSafe) payload['projectUrl'] = projectUrl;
        else if (modelUrl !== undefined) payload['modelUrl'] = modelUrl;
        void request('load-project', payload)
          .then(() => { setSceneLoaded(true); setStatus('Ready'); })
          .catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === 'project-changed') {
        dirtyRef.current = true;
        setDirty(true);
        setStatus('Unsaved editor changes');
        return;
      }
      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      const waiter = pending.current.get(requestId);
      if (waiter === undefined) return;
      pending.current.delete(requestId);
      if (message.type === 'error') {
        waiter.reject(new Error(typeof message.message === 'string' ? message.message : 'Editor operation failed'));
      } else {
        waiter.resolve(message as EditorMessage);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      for (const waiter of pending.current.values()) waiter.reject(new Error('Editor closed'));
      pending.current.clear();
    };
  }, [nonce, request]);

  const close = (): void => {
    if (dirtyRef.current && !window.confirm('Discard unsaved Three.js Editor changes?')) return;
    onClose();
  };

  const save = async (publish: boolean): Promise<void> => {
    if (busy !== null || !sceneLoaded) return;
    setBusy(publish ? 'publish' : 'save');
    setStatus(publish ? 'Exporting and publishing GLB…' : 'Saving editable project…');
    try {
      const projectMessage = await request('save-project');
      const project = projectMessage.project;
      if (project === undefined || typeof project !== 'object' || typeof project.scene !== 'object' || typeof project.camera !== 'object') {
        throw new Error('Editor returned an invalid project document');
      }
      const projectBlob = new Blob([JSON.stringify(project)], { type: 'application/json' });
      if (projectBlob.size === 0 || projectBlob.size > MAX_PROJECT_BYTES) throw new Error('Editor project exceeds the 64 MiB limit');
      const glbMessage = await request('publish-glb');
      const glbBytes = glbMessage.bytes;
      if (!(glbBytes instanceof ArrayBuffer) || glbBytes.byteLength < 12 || glbBytes.byteLength > MAX_GLB_BYTES) {
        throw new Error('Editor returned an invalid or oversized GLB');
      }
      const form = new FormData();
      form.append('project', projectBlob, 'project.app.json');
      form.append('glb', new Blob([glbBytes], { type: 'model/gltf-binary' }), 'scene.glb');
      const uploaded = await apiFetch<UploadResponse>(`/api/admin/scenes/${encodeURIComponent(scene.id)}/assets`, {
        method: 'POST',
        body: form,
      });
      const settings = {
        ...scene.settings,
        editorProjectFile: uploaded.revision.projectUrl,
        ...(publish ? { modelFile: uploaded.revision.modelUrl } : {}),
      };
      const updated = await updateScene(scene.id, { settings });
      if (updated.scene.settings['editorProjectFile'] !== uploaded.revision.projectUrl
        || (publish && updated.scene.settings['modelFile'] !== uploaded.revision.modelUrl)) {
        throw new Error('Scene record did not retain the uploaded asset references');
      }
      onSaved(updated.scene);
      dirtyRef.current = false;
      setDirty(false);
      setStatus(publish ? 'Runtime GLB published; scene pointers verified ✓' : 'Editable project saved ✓');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Scene asset save failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', gridTemplateRows: '48px minmax(0, 1fr)', background: '#1b1b1b', color: '#eee' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', font: '13px system-ui,sans-serif', borderBottom: '1px solid #444' }}>
        <button type="button" onClick={close} style={{ padding: '6px 12px' }}>Back to scenes</button>
        <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Three.js Editor · {scene.name}</strong>
        <span role="status" style={{ marginLeft: 'auto', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status}</span>
        <button type="button" disabled={!sceneLoaded || busy !== null} onClick={() => { void save(false); }}>
          {busy === 'save' ? 'Saving…' : dirty ? 'Save project *' : 'Save project'}
        </button>
        <button type="button" disabled={!sceneLoaded || busy !== null} onClick={() => { void save(true); }}>
          {busy === 'publish' ? 'Publishing…' : 'Publish runtime'}
        </button>
      </header>
      <iframe
        ref={frameRef}
        title={`Three.js Editor — ${scene.name}`}
        src={editorUrl}
        sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-modals allow-pointer-lock"
        style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
