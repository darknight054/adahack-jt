/** Renders children(data) once every query has loaded, otherwise a loading line or the first error. */
export default function Query({ q, children, loading = 'Loading…' }) {
  const queries = Array.isArray(q) ? q : [q]
  const failed = queries.find((x) => x.error)
  if (failed) return <p className="note error">{failed.error.message}</p>
  if (queries.some((x) => x.isPending)) return <p className="loading">{loading}</p>
  return children(...queries.map((x) => x.data))
}
