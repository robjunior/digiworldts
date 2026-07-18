export function Pagination({ total, page, perPage, onPage }: { readonly total: number; readonly page: number; readonly perPage: number; readonly onPage: (page: number) => void }): JSX.Element | null {
  if (total <= perPage) {
    return null;
  }
  const totalPages = Math.ceil(total / perPage);
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  return (
    <div className="pagination">
      <div className="page-info">Showing {(page - 1) * perPage + 1}-{Math.min(page * perPage, total)} of {total}</div>
      <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)}>Prev</button>
      {pages.map((pageNumber) => <button key={pageNumber} className={pageNumber === page ? 'active' : ''} type="button" onClick={() => onPage(pageNumber)}>{pageNumber}</button>)}
      <button type="button" disabled={page === totalPages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
