const MAX_FRONTS = 4;
const MAX_REPORTS_PER_FRONT = 64;
const MERGE_DISTANCE = 5;

const lifetimeFor = (kind) => kind === 'lost' ? 16 : 12;
const severityFor = (kind) => kind === 'lost' ? 1 : 0;
const compareReports = (a,b) => b.priority-a.priority || severityFor(b.kind)-severityFor(a.kind) ||
  b.at-a.at || b.sequence-a.sequence || String(a.id).localeCompare(String(b.id));
const validAlert = (alert) => alert &&
  ['damaged', 'lost', 'engineer'].includes(alert.kind) &&
  alert.id != null && Number.isFinite(Number(alert.x)) &&
  Number.isFinite(Number(alert.y)) && Number.isFinite(Number(alert.priority));

export function createTacticalFronts() {
  let fronts = [];
  let nextKey = 1;
  let nextReportSequence = 1;
  let lastTime = -Infinity;
  let focusKey = null;

  const reset = () => {
    fronts = [];
    nextKey = 1;
    nextReportSequence = 1;
    lastTime = -Infinity;
    focusKey = null;
  };

  const refresh = (front) => {
    if (!front.reports.length) return false;
    const representative = [...front.reports].sort(compareReports)[0];
    front.id = representative.id;
    front.kind = representative.kind;
    front.defId = representative.defId;
    front.x = representative.x;
    front.y = representative.y;
    front.priority = representative.priority;
    front.at = representative.at;
    front.until = Math.max(...front.reports.map((report) => report.until));
    front.count = front.reports.length;
    return true;
  };

  const prune = (time) => {
    for (const front of fronts) {
      front.reports = front.reports.filter((report) => report.until > time);
      refresh(front);
    }
    fronts = fronts.filter((front) => front.reports.length > 0);
    if (focusKey && !fronts.some((front) => front.key === focusKey)) focusKey = null;
  };

  const prepare = (time) => {
    if (time < lastTime) reset();
    lastTime = time;
    prune(time);
  };

  const ordered = () => fronts
    .sort((a, b) => b.priority - a.priority || b.at - a.at || a.key.localeCompare(b.key));

  const publicFront = ({ reports, ...front }) => ({ ...front });

  return {
    reset,
    ingest(alerts, time) {
      const now = Number(time);
      if (!Number.isFinite(now)) return this.active(lastTime);
      prepare(now);
      for (const alert of (Array.isArray(alerts) ? alerts : [])) {
        if (!validAlert(alert)) continue;
        const x = Number(alert.x), y = Number(alert.y);
        let nearest = null;
        let nearestDistance = MERGE_DISTANCE;
        for (const front of fronts) {
          // Engineer sightings are a different kind of fact from own-force
          // damage/loss, so proximity alone must not combine them.
          if ((front.kind === 'engineer') !== (alert.kind === 'engineer')) continue;
          const distance = Math.hypot(front.x - x, front.y - y);
          if (distance <= nearestDistance && (!nearest || distance < nearestDistance || front.key < nearest.key)) {
            nearest = front;
            nearestDistance = distance;
          }
        }

        const entityKey = String(alert.id);
        const reportIndex = nearest?.reports.findIndex((report) => String(report.id) === entityKey) ?? -1;
        const oldReport = reportIndex >= 0 ? nearest.reports[reportIndex] : null;
        const report = {
          id: alert.id,
          kind: alert.kind,
          defId: alert.defId,
          x, y,
          priority: Number(alert.priority),
          at: now,
          until: now + lifetimeFor(alert.kind),
          sequence: nextReportSequence++,
        };

        if (!nearest) {
          nearest = { key: `front-${nextKey++}`, reports: [report] };
          refresh(nearest);
          fronts.push(nearest);
        } else if (oldReport) {
          const keepLoss = oldReport.kind === 'lost' && alert.kind === 'damaged' &&
            Number(alert.priority) <= oldReport.priority;
          if (!keepLoss) nearest.reports[reportIndex] = report;
          refresh(nearest);
        } else if (nearest.reports.length < MAX_REPORTS_PER_FRONT) {
          nearest.reports.push(report);
          refresh(nearest);
        } else {
          // Even a crowded infantry fight must retain a newly hit command
          // asset. Replace the least important report within the fixed cap.
          const worst=nearest.reports.reduce((index,entry,i)=>
            compareReports(entry,nearest.reports[index])>0?i:index,0);
          if(compareReports(report,nearest.reports[worst])<0) {
            nearest.reports[worst]=report;
            refresh(nearest);
          }
        }
      }

      fronts.sort((a, b) => b.priority - a.priority || b.at - a.at || a.key.localeCompare(b.key));
      if (fronts.length > MAX_FRONTS) fronts = fronts.slice(0, MAX_FRONTS);
      if (focusKey && !fronts.some((front) => front.key === focusKey)) focusKey = null;
      return ordered().map(publicFront);
    },
    active(time) {
      const now = Number(time);
      if (!Number.isFinite(now)) return [];
      prepare(now);
      return ordered().map(publicFront);
    },
    focusNext(time, fromKey = focusKey) {
      const now = Number(time);
      if (!Number.isFinite(now)) return null;
      prepare(now);
      const current = ordered();
      if (!current.length) {
        focusKey = null;
        return null;
      }
      const index = current.findIndex((front) => front.key === fromKey);
      const next = current[(index + 1) % current.length];
      focusKey = next.key;
      return publicFront(next);
    },
  };
}
