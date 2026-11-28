// Seller-facing onboarding copy. Fixture rows stay sample on the server.
// Screen labels say Reference / reference record. Nothing is marked live.
// The English destructive warning is pinned in DESIGN.md 9.5 and stays verbatim.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ONBOARDING_SELLER_COPY } from './reference-copy';

const BANNED =
  /sample|demo|démo|démonstr|dimostr|demostr|sandbox|illustrative|ejemplo|exemple|esempio|exemplo|muestra|not live|演示|示例|实时/iu;
const LIVE_WORD = /\blive\b|\bvivo\b|实时/iu;

export const PINNED_DESTRUCTIVE_WARNING =
  'Delete all demonstration data? This action cannot be undone.';

type CopyMap = Record<string, string>;

const ENGLISH: CopyMap = {
  'sampleData.banner': 'You are viewing reference records.',
  'sampleData.clear': 'Clear reference records',
  'sampleData.confirmClear': PINNED_DESTRUCTIVE_WARNING,
  'templatePicker.subtitle':
    'Each template sets up a pipeline with stages and a handful of reference records so you can explore right away. You can remove the reference records any time.',
  'templatePicker.toastInstalledDescription':
    '{{stages}} stages, {{deals}} reference records, {{leads}} leads.',
  'templatePicker.toastConflictDescription':
    'Remove the existing reference records first, or start from the pipeline already in this workspace.',
  'sampleDataBanner.title': 'Reference',
  'sampleDataBanner.description':
    'Reference records are in this workspace. Hide this notice, or remove the reference records when you are ready to work from your own pipeline.',
  'sampleDataBanner.remove': 'Remove reference records',
  'sampleDataBanner.removedToast': 'Reference records removed',
  'sampleDataBanner.removeErrorToast': 'Could not remove reference records',
};

const SPANISH: CopyMap = {
  'sampleData.banner': 'Estás viendo registros de referencia.',
  'sampleData.clear': 'Quitar registros de referencia',
  'sampleData.confirmClear': '¿Eliminar todos los registros de referencia? Esta acción es irreversible.',
  'templatePicker.subtitle':
    'Cada plantilla configura un pipeline con etapas y algunos registros de referencia para que puedas explorar de inmediato. Puedes quitar los registros de referencia en cualquier momento.',
  'templatePicker.toastInstalledDescription':
    '{{stages}} etapas, {{deals}} registros de referencia, {{leads}} leads.',
  'templatePicker.toastConflictDescription':
    'Quita primero los registros de referencia existentes o empieza desde el pipeline que ya está en este espacio de trabajo.',
  'sampleDataBanner.title': 'Referencia',
  'sampleDataBanner.description':
    'Hay registros de referencia en este espacio de trabajo. Oculta este aviso o quita los registros de referencia cuando quieras trabajar con tu propio pipeline.',
  'sampleDataBanner.remove': 'Quitar registros de referencia',
  'sampleDataBanner.removedToast': 'Registros de referencia quitados',
  'sampleDataBanner.removeErrorToast': 'No se pudieron quitar los registros de referencia',
};

const FRENCH: CopyMap = {
  'sampleData.banner': 'Vous consultez des enregistrements de référence.',
  'sampleData.clear': 'Retirer les enregistrements de référence',
  'sampleData.confirmClear':
    'Supprimer tous les enregistrements de référence ? Cette action est irréversible.',
  'templatePicker.subtitle':
    'Chaque modèle crée un pipeline avec des étapes et quelques enregistrements de référence pour que vous puissiez explorer immédiatement. Vous pouvez retirer les enregistrements de référence à tout moment.',
  'templatePicker.toastInstalledDescription':
    '{{stages}} étapes, {{deals}} enregistrements de référence, {{leads}} leads.',
  'templatePicker.toastConflictDescription':
    'Retirez d’abord les enregistrements de référence existants, ou partez du pipeline déjà présent dans cet espace de travail.',
  'sampleDataBanner.title': 'Référence',
  'sampleDataBanner.description':
    'Des enregistrements de référence sont visibles dans cet espace de travail. Masquez cet avis, ou retirez les enregistrements de référence lorsque cet espace est prêt pour votre propre pipeline.',
  'sampleDataBanner.remove': 'Retirer les enregistrements de référence',
  'sampleDataBanner.removedToast': 'Enregistrements de référence retirés',
  'sampleDataBanner.removeErrorToast': 'Impossible de retirer les enregistrements de référence',
};

const PORTUGUESE: CopyMap = {
  'sampleData.banner': 'Está a visualizar registos de referência.',
  'sampleData.clear': 'Limpar registos de referência',
  'sampleData.confirmClear':
    'Eliminar todos os registos de referência? Esta ação não pode ser anulada.',
  'templatePicker.subtitle':
    'Cada modelo configura um pipeline com etapas e alguns registros de referência para você explorar imediatamente. Você pode remover os registros de referência a qualquer momento.',
  'templatePicker.toastInstalledDescription':
    '{{stages}} etapas, {{deals}} registros de referência, {{leads}} leads.',
  'templatePicker.toastConflictDescription':
    'Remova primeiro os registros de referência existentes ou comece a partir do pipeline que já está neste espaço de trabalho.',
  'sampleDataBanner.title': 'Referência',
  'sampleDataBanner.description':
    'Há registros de referência neste espaço de trabalho. Oculte este aviso ou remova os registros de referência quando quiser trabalhar a partir do seu próprio pipeline.',
  'sampleDataBanner.remove': 'Remover registros de referência',
  'sampleDataBanner.removedToast': 'Registros de referência removidos',
  'sampleDataBanner.removeErrorToast': 'Não foi possível remover os registros de referência',
};

const ITALIAN: CopyMap = {
  'sampleData.banner': 'Stai visualizzando record di riferimento.',
  'sampleData.clear': 'Cancella i record di riferimento',
  'sampleData.confirmClear':
    'Eliminare tutti i record di riferimento? Questa azione non può essere annullata.',
  'templatePicker.subtitle':
    'Ogni modello imposta una pipeline con fasi e alcuni record di riferimento così puoi esplorare subito. Puoi rimuovere i record di riferimento in qualsiasi momento.',
  'templatePicker.toastInstalledDescription':
    '{{stages}} fasi, {{deals}} record di riferimento, {{leads}} lead.',
  'templatePicker.toastConflictDescription':
    'Rimuovi prima i record di riferimento esistenti, oppure parti dalla pipeline già presente in questo spazio di lavoro.',
  'sampleDataBanner.title': 'Riferimento',
  'sampleDataBanner.description':
    'I record di riferimento sono visibili in questa area di lavoro. Nascondi questo avviso, oppure rimuovi i record di riferimento quando vuoi lavorare dalla tua pipeline.',
  'sampleDataBanner.remove': 'Rimuovi i record di riferimento',
  'sampleDataBanner.removedToast': 'Record di riferimento rimossi',
  'sampleDataBanner.removeErrorToast': 'Impossibile rimuovere i record di riferimento',
};

const CHINESE: CopyMap = {
  'sampleData.banner': '您正在查看参考记录。',
  'sampleData.clear': '清除参考记录',
  'sampleData.confirmClear': '删除所有参考记录？此操作无法撤销。',
  'templatePicker.subtitle':
    '每个模板都会创建一个包含阶段和若干参考记录的管道，让你可以立即开始探索。你可以随时删除参考记录。',
  'templatePicker.toastInstalledDescription':
    '{{stages}} 个阶段、{{deals}} 条参考记录、{{leads}} 个潜在客户。',
  'templatePicker.toastConflictDescription':
    '请先删除现有的参考记录，或从本工作区里已有的管道开始。',
  'sampleDataBanner.title': '参考',
  'sampleDataBanner.description':
    '此工作区中有参考记录。隐藏此提示，或在准备使用自己的管道时删除这些参考记录。',
  'sampleDataBanner.remove': '删除参考记录',
  'sampleDataBanner.removedToast': '参考记录已删除',
  'sampleDataBanner.removeErrorToast': '无法删除参考记录',
};

const EXPECTED: Record<string, CopyMap> = {
  en: ENGLISH,
  es: SPANISH,
  fr: FRENCH,
  pt: PORTUGUESE,
  it: ITALIAN,
  zh: CHINESE,
};

function readLocale(code: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'public/locales', code, 'onboarding.json'), 'utf8'));
}

function valueAt(json: unknown, path: string): string {
  const [group, key] = path.split('.');
  const section = (json as { [name: string]: Record<string, string> | undefined })[group!];
  return section?.[key!] ?? '';
}

describe('onboarding reference copy', () => {
  it.each(Object.keys(EXPECTED))('%s locale tells the seller Reference, not Sample or demo', (code) => {
    const json = readLocale(code);
    const expected = EXPECTED[code]!;
    for (const [path, copy] of Object.entries(expected)) {
      expect(valueAt(json, path), path).toBe(copy);
      if (!(code === 'en' && path === 'sampleData.confirmClear')) {
        expect(copy, path).not.toMatch(BANNED);
        expect(copy, path).not.toMatch(LIVE_WORD);
      }
    }
  });

  it('keeps an empty Arabic catalog on the English fallback', () => {
    expect(readLocale('ar')).toEqual({});
  });

  it('uses the English catalog as the component fallback', () => {
    expect({ ...ONBOARDING_SELLER_COPY }).toEqual(ENGLISH);
  });
});
