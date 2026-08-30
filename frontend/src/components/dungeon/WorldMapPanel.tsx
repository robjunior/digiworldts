import { Link } from 'react-router';

type WorldMapPanelProps = {
  readonly sub?: string;
};

export function WorldMapPanel({ sub }: WorldMapPanelProps): JSX.Element {
  return (
    <div className="world-map-panel">
      <div className="world-map-empty">
        Mapa Mundi
        <span className="world-map-hint">Clique abaixo para abrir o mapa completo.</span>
      </div>
      <Link to="/world" className="world-map-link">
        Abrir mapa
      </Link>
    </div>
  );
}
