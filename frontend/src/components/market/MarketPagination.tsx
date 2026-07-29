export function MarketPagination({ total, page, perPage, onPage }: { readonly total: number; readonly page: number; readonly perPage: number; readonly onPage: (page: number) => void }): JSX.Element | null {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (totalPages <= 1 && total <= perPage) {
    return null;
  }
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  const from = Math.max(1, page - 3);
  const to = Math.min(totalPages, from + 6);
  const pages = Array.from({ length: to - from + 1 }, (_, index) => from + index);

  return (
    <div className="pagination" aria-label="Market pagination">
      <div className="info">Showing {start}–{end} of {total}</div>
      <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)}>← Prev</button>
      {pages.map((candidate) => (
        <button key={candidate} type="button" className={candidate === page ? 'active' : ''} onClick={() => onPage(candidate)}>{candidate}</button>
      ))}
      <button type="button" disabled={page === totalPages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}
