import { Link } from "react-router-dom";
import {
  useBooks,
  useEmbedBackfill,
  useFinalizeIndex,
  useIndexStats,
} from "../../api/hooks";
import { ErrorNotice, Spinner } from "../../components/ui";
import { formatDate, formatNumber } from "../../lib/format";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Dashboard() {
  const stats = useIndexStats();
  const catalogue = useBooks({ limit: 1 });
  const finalize = useFinalizeIndex();
  const embed = useEmbedBackfill();

  return (
    <div className="admin-section">
      {stats.isPending ? (
        <Spinner label="Loading index statistics" />
      ) : stats.isError ? (
        <ErrorNotice error={stats.error} onRetry={() => void stats.refetch()} />
      ) : (
        <>
          <div className="stats">
            <Stat
              label="Books in catalogue"
              value={catalogue.data ? formatNumber(catalogue.data.total) : "—"}
            />
            <Stat
              label="Books indexed"
              value={formatNumber(stats.data.totalBooks)}
            />
            <Stat
              label="Passages (chunks)"
              value={formatNumber(stats.data.totalChunks)}
            />
            <Stat
              label="Distinct terms"
              value={formatNumber(stats.data.totalTerms)}
            />
            <Stat
              label="Avg. passage length"
              value={
                stats.data.avgChunkLen > 0
                  ? `${stats.data.avgChunkLen.toFixed(0)} terms`
                  : "—"
              }
              hint="As of the last recalculation"
            />
          </div>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Keyword ranking statistics</h2>
                <p className="muted small">
                  Last recalculated {formatDate(stats.data.updatedAt)}.
                </p>
              </div>
              <button
                type="button"
                className="btn"
                disabled={finalize.isPending}
                onClick={() => finalize.mutate()}
              >
                {finalize.isPending ? "Recalculating…" : "Recalculate now"}
              </button>
            </div>
            {stats.data.dirtyBooks > 0 ? (
              <p className="notice notice-warn">
                {formatNumber(stats.data.dirtyBooks)}{" "}
                {stats.data.dirtyBooks === 1 ? "book has" : "books have"} been
                added or removed since the last recalculation. They're
                searchable already, but keyword scores are approximate until you
                recalculate.
              </p>
            ) : (
              <p className="notice notice-ok">Keyword scores are up to date.</p>
            )}
            {finalize.isError && <ErrorNotice error={finalize.error} />}
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Semantic embeddings</h2>
                <p className="muted small">
                  Embeddings are created while each book is indexed. If the
                  embedding service was down, fill in what's missing here (up to
                  500 passages per run).
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={embed.isPending}
                onClick={() => embed.mutate()}
              >
                {embed.isPending ? "Embedding…" : "Embed missing passages"}
              </button>
            </div>
            {embed.data && (
              <p className="notice notice-ok">
                Embedded {formatNumber(embed.data.embeddedChunks)} passages with{" "}
                {embed.data.model} in {(embed.data.tookMs / 1000).toFixed(1)} s.{" "}
                {embed.data.remainingChunks > 0
                  ? `${formatNumber(embed.data.remainingChunks)} still missing. Run it again.`
                  : "Nothing left to embed."}
              </p>
            )}
            {embed.isError && <ErrorNotice error={embed.error} />}
          </section>

          <p className="muted small">
            Manage individual books on the <Link to="/admin/books">Books</Link>{" "}
            tab, or <Link to="/admin/upload">upload new EPUBs</Link>.
          </p>
        </>
      )}
    </div>
  );
}
