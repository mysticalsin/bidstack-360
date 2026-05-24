// Pure-CSS animated kanban board for the workflow showcase section.
// Cards drift in with staggered animations; respects prefers-reduced-motion
// (the CSS turns the animation off there, leaving a static board).
import { Icon } from './Icon';

interface DemoCard {
  title: string;
  amount: string;
  cls: string;
}

const QUALIFIED: DemoCard[] = [
  { title: 'Stellar Logistics RFP', amount: '€480k', cls: 'mkt-kanban-card mkt-kanban-card-2' },
  { title: 'Atlas Power Group', amount: '€220k', cls: 'mkt-kanban-card mkt-kanban-card-3' },
];

const IN_PROGRESS: DemoCard[] = [
  { title: 'Nova Telecom 2026', amount: '€1.2M', cls: 'mkt-kanban-card mkt-kanban-card-4' },
  { title: 'Argos Health framework', amount: '€640k', cls: 'mkt-kanban-card mkt-kanban-card-5' },
];

const WON: DemoCard[] = [{ title: 'Mantu UK extension', amount: '€310k', cls: 'mkt-kanban-card mkt-kanban-card-6' }];

export function KanbanDemo() {
  return (
    <div
      className="mkt-kanban"
      role="img"
      aria-label="Animated demo of a sales pipeline with three columns: Qualified, In progress, Won."
    >
      <div className="mkt-kanban-col">
        <h4>Qualified</h4>
        {QUALIFIED.map((c) => (
          <div key={c.title} className={c.cls}>
            {c.title}
            <span className="mkt-kanban-amount">{c.amount}</span>
          </div>
        ))}
      </div>
      <div className="mkt-kanban-col">
        <h4>In progress</h4>
        {IN_PROGRESS.map((c) => (
          <div key={c.title} className={c.cls}>
            {c.title}
            <span className="mkt-kanban-amount">{c.amount}</span>
          </div>
        ))}
      </div>
      <div className="mkt-kanban-col">
        <h4>Won</h4>
        {WON.map((c) => (
          <div key={c.title} className={c.cls}>
            <span className="inline-flex items-center gap-1">
              <Icon.Check width={14} height={14} className="text-[color:var(--success)]" />
              {c.title}
            </span>
            <span className="mkt-kanban-amount">{c.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
