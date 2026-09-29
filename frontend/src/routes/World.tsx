import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getPveWorld } from '../lib/api-world';
import { requestExpeditionConfig } from '../lib/rail-expeditions-store';
import { WorldStrip } from '../components/world/WorldStrip';
import { WorldHoverTip } from '../components/world/WorldHoverTip';
import { useWorldGlobeUI, worldGlobeStore, usePopupAnchor, popupAnchorStore } from '../lib/world-globe-store';
import { CloseIcon, WorldIcon } from '../components/common/icons';
import '../styles/extensions-world.css';

// A cena 3D (globo + digimons) vive no WorldSceneHost (AppShell), persistente —
// esta página só desenha a UI do overlay por cima dela e lê o worldGlobeStore
// pro estado interativo (seleção, hover, fallback de WebGL). A configuração de
// party/batalha/expedição mora no RAIL (Expedições → Config), então o popup
// aqui é compacto: nome da localidade + botões (ícone+texto) que abrem o rail.
// O globo NÃO gira sozinho — só a rotação do jogador (arraste).
export function World(): JSX.Element {
  const world = useQuery({ queryKey: ['pve-world'], queryFn: getPveWorld });

  const ui = useWorldGlobeUI();
  const popupAnchor = usePopupAnchor();

  const places = world.data?.places ?? [];
  const selectedPlace = ui.selectedIdx === null ? null : (places[ui.selectedIdx] ?? null);

  // Fecha o popup: limpa seleção/foco e solta a âncora.
  const closePopup = useCallback(() => {
    worldGlobeStore.set({ selectedIdx: null, focus: null, autoSpin: false });
    popupAnchorStore.set(null);
  }, []);
  // Explore abre o rail (aba Expedições → Config) com o node pré-selecionado;
  // o Config controla tanto expedição quanto batalha.
  const openExplore = useCallback(() => {
    if (selectedPlace) requestExpeditionConfig(selectedPlace.id);
  }, [selectedPlace]);

  return (
    <main className="world-page-layout world-legacy">
      <div className="stage" data-od-id="globe-stage">
        {ui.webglFailed ? (
          <div className="stage-fallback show" role="status">
            <div className="box">
              <b>Mapa 3D indisponível</b>
              <br />
              Selecione uma localidade na lista.
            </div>
          </div>
        ) : null}
        <div className="overlay">
          <WorldStrip />
          <WorldHoverTip tip={ui.hoverTip} />
        </div>
      </div>
      {selectedPlace ? (
        <section
          className="world-place-popup"
          aria-label={`Localidade ${selectedPlace.name}`}
          style={popupAnchor ? { position: 'fixed', left: popupAnchor.x, top: popupAnchor.y - 14, transform: 'translate(-50%, -100%)', zIndex: 50, margin: 0 } : undefined}
        >
          <button type="button" className="world-place-popup__close" onClick={closePopup} aria-label="Fechar localidade">
            <CloseIcon />
          </button>
          <span className="world-place-popup__name">{selectedPlace.name}</span>
          <div className="world-place-popup__actions">
            <button type="button" className="world-place-popup__act" onClick={openExplore}>
              <WorldIcon />
              <span>Explore</span>
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}