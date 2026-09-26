import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { Animation } from './js/Animation.js';
import { AnimationResizer } from './js/AnimationResizer.js';
import { Editor } from './js/Editor.js';
import { Menubar } from './js/Menubar.js';
import { Player } from './js/Player.js';
import { Resizer } from './js/Resizer.js';
import { Script } from './js/Script.js';
import { Sidebar } from './js/Sidebar.js';
import { Toolbar } from './js/Toolbar.js';
import { Viewport } from './js/Viewport.js';
import { SetSceneCommand } from './js/commands/SetSceneCommand.js';
import './css/main.css';

const CHANNEL = 'digiworld.three-editor.v1';
const nonce = new URLSearchParams(window.location.search).get('nonce');
const editor = new Editor();
let projectLoaded = false;

window.editor = editor;
window.THREE = THREE;
THREE.ObjectLoader.registerGeometry('TextGeometry', TextGeometry);

const viewport = new Viewport(editor);
document.body.appendChild(viewport.dom);
const toolbar = new Toolbar(editor);
document.body.appendChild(toolbar.dom);
document.body.appendChild(new Script(editor).dom);
document.body.appendChild(new Player(editor).dom);
document.body.appendChild(new Sidebar(editor).dom);
document.body.appendChild(new Menubar(editor).dom);
document.body.appendChild(new Resizer(editor).dom);
const animation = new Animation(editor);
document.body.appendChild(animation.dom);
document.body.appendChild(new AnimationResizer(editor).dom);

editor.signals.animationPanelChanged.add((height) => {
  const visible = height !== false;
  viewport.dom.classList.toggle('with-animation', visible);
  toolbar.dom.classList.toggle('with-animation', visible);
  if (visible) {
    viewport.dom.style.bottom = `${height}px`;
    toolbar.dom.style.bottom = `${height + 20}px`;
  } else {
    viewport.dom.style.bottom = '';
    toolbar.dom.style.bottom = '';
  }
  editor.signals.windowResize.dispatch();
});

function send(type, requestId, payload = {}, transfer = []) {
  if (window.parent === window) return;
  window.parent.postMessage({ channel: CHANNEL, nonce, type, requestId, ...payload }, window.location.origin, transfer);
}

function resize() {
  editor.signals.windowResize.dispatch();
}
window.addEventListener('resize', resize);
resize();

async function loadProject(project) {
  if (!project || typeof project !== 'object' || !project.scene || !project.camera) {
    throw new Error('Unsupported Three.js Editor project document');
  }
  await editor.fromJSON(project);
  resize();
}

async function loadGlb(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load base GLB (${response.status})`);
  const bytes = await response.arrayBuffer();
  const basePath = new URL('.', new URL(url, window.location.href)).href;
  const gltf = await new GLTFLoader().parseAsync(bytes, basePath);
  editor.clear();
  gltf.scene.animations = gltf.animations;
  editor.execute(new SetSceneCommand(editor, gltf.scene));
  resize();
}

async function handleMessage(event) {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.channel !== CHANNEL || message.nonce !== nonce || typeof message.type !== 'string') return;

  const requestId = typeof message.requestId === 'string' ? message.requestId : '';
  try {
    switch (message.type) {
      case 'load-project':
        if (message.projectUrl) {
          const response = await fetch(message.projectUrl, { credentials: 'same-origin' });
          if (!response.ok) throw new Error(`Could not load saved project (${response.status})`);
          await loadProject(await response.json());
        } else if (message.project) {
          await loadProject(message.project);
        } else if (message.modelUrl) {
          await loadGlb(message.modelUrl);
        } else {
          editor.signals.sceneEnvironmentChanged.dispatch('Default');
        }
        projectLoaded = true;
        send('loaded', requestId);
        break;
      case 'save-project':
        send('project', requestId, { project: editor.toJSON() });
        break;
      case 'publish-glb': {
        const bytes = await new GLTFExporter().parseAsync(editor.scene, {
          binary: true,
          onlyVisible: true,
          maxTextureSize: 4096,
          animations: editor.scene.animations,
        });
        if (!(bytes instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return binary GLB data');
        send('glb', requestId, { bytes }, [bytes]);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    send('error', requestId, { message: error instanceof Error ? error.message : String(error) });
  }
}

window.addEventListener('message', (event) => { void handleMessage(event); });
for (const signal of [editor.signals.sceneGraphChanged, editor.signals.objectChanged, editor.signals.materialChanged]) {
  signal.add(() => {
    if (projectLoaded) send('project-changed', '');
  });
}
editor.signals.sceneEnvironmentChanged.dispatch('Default');
send('ready', '', { version: 'r185', upstreamCommit: '2431a09f46f34c560bc8e44b33be0e567723d5b9' });
