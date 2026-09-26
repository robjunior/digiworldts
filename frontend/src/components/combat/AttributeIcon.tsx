import type { Attribute } from '@digiworld/shared/digimon';

const ATTRIBUTE_LABEL: Record<Attribute, string> = {
  Data: 'D',
  Vaccine: 'V',
  Virus: 'X',
  Free: 'F',
  Variable: 'V?',
  Unknown: '?',
  NoData: '—',
};

export function AttributeIcon({ attribute, size = 'md' }: { readonly attribute: Attribute; readonly size?: 'sm' | 'md' }): JSX.Element {
  const safeAttribute = attribute ?? 'Unknown';
  return (
    <span
      className={`attribute-icon attribute-icon--${size} attribute-icon--${safeAttribute.toLowerCase()}`}
      title={safeAttribute}
      aria-label={safeAttribute}
    >
      {ATTRIBUTE_LABEL[safeAttribute]}
    </span>
  );
}
