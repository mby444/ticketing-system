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
} from "@/lib/dashboard-filters";
import TicketTable from "@/components/dashboard/TicketTable";

const SectionHeading = ({
  title,
  count,
}: {
  title: string;
  count: number;
}) => (
  <div className="flex items-center gap-2 mb-3">
    <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
    <span className="text-xs font-semibold bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
      {count}
    </span>
  </div>
);

// ReactNode rather than string: the filtered empty note interpolates a label,
// which is a ReactNode rather than a single string.
const EmptyNote = ({ children }: { children: ReactNode }) => (
  <p className="text-center text-sm text-gray-500 bg-white border border-dashed border-gray-200 rounded-lg py-6">
    {children}
  </p>
);

/**
 * Triage filters, rendered as plain links. No client component and no state:
 * the active filter lives in `?filter=`, so a view is bookmarkable, survives a
 * refresh, and keeps working without JS. The href is built from the whitelisted
 * constant, never from the raw query value.
 */
const FilterNav = ({
  filter,
  counts,
}: {
  filter: (typeof DASHBOARD_FILTERS)[number];
  counts: Record<string, number>;
}) => (
  <nav
    aria-label="Ticket filters"
    className="flex flex-wrap gap-2 justify-center mb-6"
  >
    {DASHBOARD_FILTERS.map((option) => {
      const active = option === filter;
      return (
        <Link
          key={option}
          href={
            option === DEFAULT_DASHBOARD_FILTER
              ? "/dashboard"
              : `/dashboard?filter=${option}`
          }
          scroll={false}
          aria-current={active ? "page" : undefined}
          className={`px-3 py-1.5 rounded-full text-sm border transition ${
            active
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
          }`}
        >
          {DASHBOARD_FILTER_LABELS[option]}
          <span className={active ? "ml-1.5 text-blue-100" : "ml-1.5 text-gray-400"}>
            {counts[option] ?? 0}
          </span>
        </Link>
      );
    })}
  </nav>
);

const StaffDashboardPage = async (props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) => {
  // Role guard stays first: `?filter=` must never be a way around it.
  const user = await requireRole(...STAFF_ROLES);
  const [params, tickets, agents] = await Promise.all([
    props.searchParams,
    getAllTickets(),
    listAgents(),
  ]);

  const filter = parseDashboardFilter(params.filter);
  const filtered = filterDashboardTickets(tickets, filter, user.id);
  const counts = Object.fromEntries(
    DASHBOARD_FILTERS.map((option) => [
      option,
      countDashboardFilter(tickets, option, user.id),
    ]),
  );

  // Partition of the single getAllTickets() query: "Assigned to me" sorts
  // active statuses before Closed, then newest first; "Other tickets"
  // keeps the original createdAt-desc order.
  const mine = tickets
    .filter((ticket) => ticket.assigneeId === user.id)
    .sort(
      (a, b) =>
        Number(a.status === "Closed") - Number(b.status === "Closed") ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  const others = tickets.filter((ticket) => ticket.assigneeId !== user.id);

  const filteredView = filter !== DEFAULT_DASHBOARD_FILTER;

  return (
    <div className="min-h-screen bg-blue-50 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-blue-600 mb-2 text-center">
          Staff Dashboard
        </h1>
        <p className="text-center text-gray-600 mb-6">
          {filteredView ? (
            <>
              Showing {filtered.length} of {tickets.length} tickets —{" "}
              {DASHBOARD_FILTER_LABELS[filter]}
            </>
          ) : (
            <>
              {mine.length} assigned to you · {tickets.length} ticket
              {tickets.length === 1 ? "" : "s"} total — update status and
              assign agents
            </>
          )}
        </p>

        <FilterNav filter={filter} counts={counts} />

        {tickets.length === 0 ? (
          <p className="text-center text-gray-600">No Tickets Yet</p>
        ) : filteredView ? (
          // A filtered view is a single table. Keeping the two-section layout
          // here would guarantee an empty section — "unassigned" can never
          // contain anything assigned to you — and an empty "Assigned to me"
          // note would read as bad news rather than as the filter working.
          filtered.length === 0 ? (
            <EmptyNote>
              No tickets match “{DASHBOARD_FILTER_LABELS[filter]}”
            </EmptyNote>
          ) : (
            <section>
              <SectionHeading
                title={DASHBOARD_FILTER_LABELS[filter]}
                count={filtered.length}
              />
              <TicketTable tickets={filtered} agents={agents} />
            </section>
          )
        ) : (
          <>
            <section className="mb-8">
              <SectionHeading title="Assigned to me" count={mine.length} />
              {mine.length === 0 ? (
                <EmptyNote>No tickets assigned to you yet</EmptyNote>
              ) : (
                <TicketTable tickets={mine} agents={agents} />
              )}
            </section>

            <section>
              <SectionHeading title="Other tickets" count={others.length} />
              {others.length === 0 ? (
                <EmptyNote>No other tickets</EmptyNote>
              ) : (
                <TicketTable tickets={others} agents={agents} />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default StaffDashboardPage;
