import { Navigate } from 'react-router-dom';

export default function WebhooksPage() {
  return <Navigate to="/settings?tab=webhooks" replace />;
}
