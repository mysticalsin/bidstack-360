/**
 * ChileCompra attribution strings for UI and exports.
 *
 * The Mercado Publico API terms require anyone publishing its data to state
 * that the source is Direccion ChileCompra. Web-safe: re-exported from the
 * package root so the UI can render it on every data view.
 */

/** Line for views that show data Polo has processed (the default). */
export const CHILECOMPRA_ATTRIBUTION =
  'Fuente: Dirección ChileCompra (Mercado Público). Datos procesados por Polo.';

/** Line for views that show API data without modification. */
export const CHILECOMPRA_ATTRIBUTION_UNMODIFIED = 'Fuente de los datos: Dirección ChileCompra.';

/** Pick the attribution line for a view. */
export function chileCompraAttribution(opts: { modified: boolean }): string {
  return opts.modified ? CHILECOMPRA_ATTRIBUTION : CHILECOMPRA_ATTRIBUTION_UNMODIFIED;
}

/** Licence identifiers carried on Chile records. */
export const CHILE_LICENCES = {
  /** Mercado Publico REST API: ChileCompra terms of use. */
  api: 'ChileCompra-API-terms',
  /** OCDS API: every package states CC0 1.0. */
  ocds: 'CC0-1.0',
  /** Datos Abiertos bulk files: ChileCompra open data terms. */
  bulk: 'ChileCompra-datos-abiertos',
} as const;
