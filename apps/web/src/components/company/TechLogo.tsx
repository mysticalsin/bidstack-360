import { useState, type CSSProperties } from 'react';

// Mapping from Technical Stack item names → Simple Icons slugs.
// Simple Icons (https://simpleicons.org) is a free, brand-asset-licensed CDN
// covering 3000+ brands. CDN: https://cdn.simpleicons.org/{slug}[/{hexColor}].
// Slugs are lowercase, no spaces, no special chars. Unknown brands fall back
// to a plain text pill via the onError handler below.
const SLUG_MAP: Record<string, string> = {
  // IT Infrastructure / Cloud
  'microsoft 365': 'microsoft',
  'office 365': 'microsoft',
  microsoft: 'microsoft',
  azure: 'microsoftazure',
  'microsoft azure': 'microsoftazure',
  aws: 'amazonwebservices',
  'amazon web services': 'amazonwebservices',
  'google cloud': 'googlecloud',
  'google cloud platform': 'googlecloud',
  gcp: 'googlecloud',
  vmware: 'vmware',
  oracle: 'oracle',
  ibm: 'ibm',
  'red hat': 'redhat',
  redhat: 'redhat',
  ubuntu: 'ubuntu',
  digitalocean: 'digitalocean',
  linode: 'linode',
  vercel: 'vercel',
  netlify: 'netlify',
  // Identity & Access
  okta: 'okta',
  auth0: 'auth0',
  // Security
  crowdstrike: 'crowdstrike',
  cloudflare: 'cloudflare',
  // Endpoints
  jamf: 'jamf',
  windows: 'windows11',
  'windows 11': 'windows11',
  'windows 10': 'windows10',
  macos: 'macos',
  ios: 'ios',
  android: 'android',
  // Network
  cisco: 'cisco',
  'cisco meraki': 'cisco',
  // Applications
  salesforce: 'salesforce',
  servicenow: 'servicenow',
  workday: 'workday',
  slack: 'slack',
  jira: 'jira',
  confluence: 'confluence',
  notion: 'notion',
  asana: 'asana',
  linear: 'linear',
  github: 'github',
  gitlab: 'gitlab',
  bitbucket: 'bitbucket',
  figma: 'figma',
  zoom: 'zoom',
  hubspot: 'hubspot',
  zendesk: 'zendesk',
  intercom: 'intercom',
  stripe: 'stripe',
  shopify: 'shopify',
  twilio: 'twilio',
  sendgrid: 'mailchimp', // close enough; no sendgrid icon
  mailchimp: 'mailchimp',
  // Data & analytics
  snowflake: 'snowflake',
  databricks: 'databricks',
  mongodb: 'mongodb',
  postgresql: 'postgresql',
  postgres: 'postgresql',
  mysql: 'mysql',
  redis: 'redis',
  elasticsearch: 'elastic',
  elastic: 'elastic',
  kafka: 'apachekafka',
  splunk: 'splunk',
  datadog: 'datadog',
  newrelic: 'newrelic',
  grafana: 'grafana',
  prometheus: 'prometheus',
  // Misc commonly seen
  docker: 'docker',
  kubernetes: 'kubernetes',
  terraform: 'terraform',
  ansible: 'ansible',
};

function slugFor(name: string): string | null {
  const key = name.trim().toLowerCase();
  return SLUG_MAP[key] ?? null;
}

interface TechLogoProps {
  name: string;
  size?: number;
  /** Hex color override (no `#`); defaults to Simple Icons' brand color. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function TechLogo({ name, size = 14, color, className, style }: TechLogoProps) {
  const slug = slugFor(name);
  const [failed, setFailed] = useState(false);

  if (!slug || failed) {
    // Unknown brand — render an initial bubble. Pairs with the existing .tech-pill.
    return (
      <span
        className={className}
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: 4,
          background: 'var(--surface-sunken)',
          color: 'var(--fg-tertiary)',
          fontSize: Math.max(8, Math.round(size * 0.6)),
          fontWeight: 700,
          flexShrink: 0,
          ...style,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }

  const url = color
    ? `https://cdn.simpleicons.org/${slug}/${color}`
    : `https://cdn.simpleicons.org/${slug}`;

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
      style={{ flexShrink: 0, ...style }}
    />
  );
}
