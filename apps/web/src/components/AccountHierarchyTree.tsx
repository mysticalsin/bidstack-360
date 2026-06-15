import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui/Icon';

interface HierarchyNode {
  id: string;
  name: string;
  parentId: string | null;
  children: HierarchyNode[];
}

function TreeNode({
  node,
  depth = 0,
}: {
  node: HierarchyNode;
  depth?: number;
}) {
  return (
    <li className="mt-1">
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[var(--surface-sunken)] transition-colors"
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      >
        <Icon name="building" size={14} className="text-[var(--fg-tertiary)]" />
        <Link
          to={`/companies/${node.id}`}
          className="text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
        >
          {node.name}
        </Link>
        {node.children.length > 0 && (
          <span className="text-xs text-[var(--fg-tertiary)]">({node.children.length})</span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="border-l border-[var(--border-subtle)] ml-3">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AccountHierarchyTree({ tree }: { tree: HierarchyNode }) {
  const { t } = useTranslation('crm');
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-[var(--fg-primary)] mb-3">
        {t('accountHierarchyTree.heading', 'Account Hierarchy')}
      </h3>
      <ul>
        <TreeNode node={tree} />
      </ul>
    </div>
  );
}
