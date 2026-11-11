import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import "../../styles/corner-bar.css";

export type CornerBarProps = {
  /** Controlado pelo pai (exclusividade de menus); omitido = estado interno. */
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /** Classe extra na raiz, p.ex. `quest-bar` quando o estilo é o do quest bar. */
  readonly className?: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  /** Número no badge; null/0 esconde. */
  readonly badge?: number | null;
  /** `gold` (pronto p/ resgatar) ou `signal` (contagem neutra). */
  readonly badgeTone?: "gold" | "signal";
  /**
   * Altura máx do painel expandido. Default compartilhado — omitir para
   * herdar o sizing padrão (é o caso de todos os cantos atuais).
   */
  readonly panelMaxHeight?: string;
  /**
   * Altura MÍNIMA do painel aberto. Mantém um canto com conteúdo curto
   * (o social, p.ex.) com o mesmo porte de um canto cheio, em vez de
   * encolher até o tamanho da lista. Só entra em conta quando aberto —
   * fechado, o painel é max-height:0 e some.
   */
  readonly panelMinHeight?: string;
  readonly panelLabel?: string;
  readonly dataOdId?: string;
  /** Chamado a cada clique no gatilho (abrir OU fechar), depois do toggle. */
  readonly onTriggerClick?: () => void;
  readonly children?: ReactNode;
};

/* Sizing padrão de TODOS os cantos. Vive aqui, e não em cada página, porque
   foi exatamente assim que eles divergiram: social 560/500, world 520, nursery
   500, quest 360. Um canto por padrão, e a página só declara a largura.
   O piso é teto-em-vh — numa janela baixa o teto (60vh) ficaria abaixo dos
   500px e o `min-height` estouraria o canto pra fora da viewport. */
const PANEL_MAX_HEIGHT_DEFAULT = "min(60vh, 560px)";
const PANEL_MIN_HEIGHT_DEFAULT = "min(500px, 60vh)";

/**
 * CornerBar — o "canto" colapsável padrão do DigiWorld (o mesmo chrome do
 * quest bar do lobby). Colapsado é UM trigger; clicar expande o painel PARA
 * CIMA; clicar fora, apertar Escape ou o próprio gatilho de novo fecha.
 *
 * Existe porque quatro cantos diferentes precisam do mesmo comportamento e da
 * mesma aparência (quest bar do lobby, expedições no world, hatchery no
 * nursery, social em world/nursery). Um só componente + uma só folha de estilo
 * garante que nenhum deles derive visualmente do outro: o conteúdo do painel é
 * `children`, mas o chrome (trigger, ícone, badge, caret, animação) é sempre
 * deste componente, nunca da página dona.
 */
export function CornerBar({
  open,
  onOpenChange,
  className,
  icon,
  title,
  subtitle,
  badge = null,
  badgeTone = "gold",
  panelMaxHeight = PANEL_MAX_HEIGHT_DEFAULT,
  panelMinHeight = PANEL_MIN_HEIGHT_DEFAULT,
  panelLabel,
  dataOdId,
  onTriggerClick,
  children,
}: CornerBarProps): JSX.Element {
  // Estado interno só é usado quando o pai não controla (uso avulso).
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const rootRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (next: boolean): void => {
      if (onOpenChange) onOpenChange(next);
      else setInternalOpen(next);
    },
    [onOpenChange],
  );

  const toggle = useCallback((): void => {
    setOpen(!isOpen);
    onTriggerClick?.();
  }, [isOpen, setOpen, onTriggerClick]);
  const close = useCallback((): void => setOpen(false), [setOpen]);

  // Fecha ao clicar fora — mesmo contrato do quest bar.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const showBadge = badge !== null && badge > 0;
  const rootClass = ["cbar", className, isOpen ? "open" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} ref={rootRef} data-od-id={dataOdId}>
      <button
        type="button"
        className="cbar-trigger"
        aria-expanded={isOpen}
        aria-label={`${title} — ${subtitle}`}
        onClick={toggle}
      >
        <span className="cbar-ico">{icon}</span>
        <span className="cbar-tx">
          <span className="cbar-nm">{title}</span>
          <span className="cbar-sub">{subtitle}</span>
        </span>
        {showBadge && (
          <span className={`cbar-badge t-${badgeTone}`}>{badge}</span>
        )}
        <span className={`cbar-caret${isOpen ? " open" : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8l6 6-6 6-6-6z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      <div
        className="cbar-panel"
        aria-hidden={!isOpen}
        style={
          isOpen
            ? { maxHeight: panelMaxHeight, minHeight: panelMinHeight }
            : undefined
        }
        {...(panelLabel !== undefined ? { "aria-label": panelLabel } : {})}
      >
        {children}
      </div>
    </div>
  );
}
