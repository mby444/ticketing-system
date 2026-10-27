import type { ReactNode } from "react";
import Link from "next/link";
import { getAllTickets, listAgents } from "@/actions/ticket.actions";
import { requireRole, STAFF_ROLES } from "@/lib/authorization";
import {
  countDashboardFilter,
  DASHBOARD_FILTERS,
  DASHBOARD_FILTER_LABELS,
  DEFAULT_DASHBOARD_FILTER,
  filterDashboardTickets,
  parseDashboardFilter,
  type DashboardFilter,
} from "@/lib/dashboard-filters";
import {
  buildDashboardHref,
  DASHBOARD_SORT_LABELS,
  DEFAULT_DASHBOARD_SORT,
  parseDashboardSort,
  sortDashboardTickets,
} from "@/lib/dashboard-sort";
import TicketTable from "@/components/dashboard/TicketTable";

const SectionHeading = ({
  title,
  count,
}: {
  title: string;
  count: number;
}) => (
  <div className="flex items-center gap-3 mb-3">
    <h2 className="text-headline-sm text-slate-900 tracking-tight">{title}</h2>
    <span className="bg-primary/10 text-primary font-label-sm px-2.5 py-0.5 rounded-full font-semibold">
      {count}
    </span>
  </div>
);

const EmptyNote = ({ children }: { children: ReactNode }) => (
  <p className="text-center text-sm text-slate-500 bg-white border border-dashed border-slate-200 rounded-xl py-6">
    {children}
  </p>
);

const FilterNav = ({
  filter,
  sort,
  counts,
}: {
  filter: DashboardFilter;
  sort: ReturnType<typeof parseDashboardSort>;
  counts: Record<string, number>;
}) => (
  <nav
    aria-label="Ticket filters"
    className="flex items-center justify-center overflow-x-auto pb-2"
  >
    <div className="inline-flex items-center gap-1 p-1.5 bg-surface-container-low rounded-full shadow-card">
      {DASHBOARD_FILTERS.map((option) => {
        const active = option === filter;
        return (
          <Link
            key={option}
            href={buildDashboardHref({ filter: option, sort })}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-label-md transition-colors ${
              active
                ? "bg-primary-container text-on-primary shadow-sm"
                : "bg-surface-container-lowest text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <span>{DASHBOARD_FILTER_LABELS[option]}</span>
            <span
              className={`px-2 py-0.5 rounded-full font-label-sm font-semibold ${
                active ? "bg-white/20 text-on-primary" : "bg-slate-100 text-slate-600"
              }`}
            >
              {counts[option] ?? 0}
            </span>
          </Link>
        );
      })}
    </div>
  </nav>
);

const KpiCard = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) => (
  <div
    className="bg-surface-container-lowest p-5 rounded-xl shadow-card flex items-center justify-between border-t-2"
    style={{ borderTopColor: accent }}
  >
    <div>
      <span className="font-label-sm text-slate-500 uppercase tracking-wider block">
        {label}
      </span>
      <span className="text-headline-md text-slate-900 block mt-1">{value}</span>
    </div>
  </div>
);

const StaffDashboardPage = async (props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) => {
  const user = await requireRole(...STAFF_ROLES);
  const [params, tickets, agents] = await Promise.all([
    props.searchParams,
    getAllTickets(),
    listAgents(),
  ]);

  const filter = parseDashboardFilter(params.filter);
  const sort = parseDashboardSort(params.sort);
  const filtered = sortDashboardTickets(
    filterDashboardTickets(tickets, filter, user.id),
    sort,
  );
  const counts = Object.fromEntries(
    DASHBOARD_FILTERS.map((option) => [
      option,
      countDashboardFilter(tickets, option, user.id),
    ]),
  );

  const mine = sortDashboardTickets(
    tickets.filter((ticket) => ticket.assigneeId === user.id),
    sort,
  );
  const others = sortDashboardTickets(
    tickets.filter((ticket) => ticket.assigneeId !== user.id),
    sort,
  );

  const filteredView = filter !== DEFAULT_DASHBOARD_FILTER;

  const total = tickets.length;
  const unassigned = tickets.filter((t) => !t.assigneeId).length;
  const mineCount = tickets.filter((t) => t.assigneeId === user.id).length;
  const openCount = tickets.filter((t) => t.status !== "Closed").length;

  return (
    <div className="min-h-screen bg-surface p-6 md:p-8">
      <div className="max-w-7xl mx-auto flex flex-col gap-8">
        <div className="flex flex-col items-center text-center space-y-2">
          <h1 className="text-headline-lg text-slate-900 tracking-tight">
            Staff Dashboard
          </h1>
          <p className="text-body-md text-slate-500">
            {filteredView ? (
              <>
                Showing {filtered.length} of {tickets.length} tickets ?{" "}
                {DASHBOARD_FILTER_LABELS[filter]}, {DASHBOARD_SORT_LABELS[sort].toLowerCase()}
              </>
            ) : (
              <>
                <span className="font-semibold text-slate-700">
                  {mineCount} assigned to you
                </span>{" "}
                ? {tickets.length} ticket{tickets.length === 1 ? "" : "s"} total ? sorted by{" "}
                {DASHBOARD_SORT_LABELS[sort].toLowerCase()}
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total Tickets" value={total} accent="var(--primary-container)" />
          <KpiCard label="Unassigned" value={unassigned} accent="var(--warning-text)" />
          <KpiCard label="Assigned to me" value={mineCount} accent="var(--primary)" />
          <KpiCard label="Open (not closed)" value={openCount} accent="var(--success-text)" />
        </div>

        <FilterNav filter={filter} sort={sort} counts={counts} />

        {tickets.length === 0 ? (
          <p className="text-center text-slate-600">No Tickets Yet</p>
        ) : filteredView ? (
          filtered.length === 0 ? (
            <EmptyNote>
              No tickets match ?{DASHBOARD_FILTER_LABELS[filter]}?.{" "}
              {sort !== DEFAULT_DASHBOARD_SORT && (
                <>
                  <Link
                    href={buildDashboardHref({ filter, sort: DEFAULT_DASHBOARD_SORT })}
                    scroll={false}
                    className="text-primary hover:underline"
                  >
                    Reset the sort
                  </Link>{" "}
                  to see more.
                </>
              )}
            </EmptyNote>
          ) : (
            <section>
              <SectionHeading
                title={DASHBOARD_FILTER_LABELS[filter]}
                count={filtered.length}
              />
              <TicketTable tickets={filtered} agents={agents} filter={filter} sort={sort} />
            </section>
          )
        ) : (
          <>
            <section className="mb-8">
              <SectionHeading title="Assigned to me" count={mine.length} />
              {mine.length === 0 ? (
                <EmptyNote>No tickets assigned to you yet</EmptyNote>
              ) : (
                <TicketTable tickets={mine} agents={agents} filter={filter} sort={sort} />
              )}
            </section>

            <section>
              <SectionHeading title="Other tickets" count={others.length} />
              {others.length === 0 ? (
                <EmptyNote>No other tickets</EmptyNote>
              ) : (
                <TicketTable tickets={others} agents={agents} filter={filter} sort={sort} />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default StaffDashboardPage;
