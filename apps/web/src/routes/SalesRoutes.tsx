/**
 * salesRouteElements — sales, orders, invoices and products route definitions.
 *
 * WHY a function: same reason as BidRoutes — React Router v6 traverses JSX
 * children statically; a function call lets the framework see Route elements
 * that would otherwise be hidden inside a component boundary.
 */
import { Route } from 'react-router-dom';

import {
  InvoiceDetailPage,
  InvoicesPage,
  NewInvoicePage,
  NewSalesOrderPage,
  ProductsPage,
  SalesDashboardPage,
  SalesOrderDetailPage,
  SalesOrdersPage,
} from './lazyPages';
import { RequireAuth } from './AuthGuards';

export function salesRouteElements() {
  return (
    <>
      <Route
        path="/sales"
        element={
          <RequireAuth>
            <SalesDashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sales/orders"
        element={
          <RequireAuth>
            <SalesOrdersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sales/orders/new"
        element={
          <RequireAuth>
            <NewSalesOrderPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sales/orders/:id"
        element={
          <RequireAuth>
            <SalesOrderDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sales/invoices"
        element={
          <RequireAuth>
            <InvoicesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sales/invoices/new"
        element={
          <RequireAuth>
            <NewInvoicePage />
          </RequireAuth>
        }
      />
      <Route
        path="/sales/invoices/:id"
        element={
          <RequireAuth>
            <InvoiceDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sales/products"
        element={
          <RequireAuth>
            <ProductsPage />
          </RequireAuth>
        }
      />
    </>
  );
}
