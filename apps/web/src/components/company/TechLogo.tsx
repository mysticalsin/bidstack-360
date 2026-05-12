import { useState, type CSSProperties } from 'react';

// Technical stack logos resolve from official domains through a resilient
// favicon service. That keeps enterprise brand chips visual without noisy 404s
// when a brand is absent from an icon CDN. Unknown brands fall back to initials.
const DOMAIN_MAP: Record<string, string> = {
  'active directory': 'microsoft.com',
  android: 'android.com',
  ansible: 'ansible.com',
  asana: 'asana.com',
  auth0: 'auth0.com',
  aws: 'aws.amazon.com',
  azure: 'azure.microsoft.com',
  bitbucket: 'bitbucket.org',
  cisco: 'cisco.com',
  'cisco meraki': 'meraki.cisco.com',
  cloudflare: 'cloudflare.com',
  confluence: 'atlassian.com',
  crowdstrike: 'crowdstrike.com',
  databricks: 'databricks.com',
  datadog: 'datadoghq.com',
  digitalocean: 'digitalocean.com',
  docker: 'docker.com',
  duo: 'duo.com',
  elastic: 'elastic.co',
  elasticsearch: 'elastic.co',
  figma: 'figma.com',
  gcp: 'cloud.google.com',
  github: 'github.com',
  gitlab: 'gitlab.com',
  'google cloud': 'cloud.google.com',
  'google cloud platform': 'cloud.google.com',
  grafana: 'grafana.com',
  hubspot: 'hubspot.com',
  ibm: 'ibm.com',
  intercom: 'intercom.com',
  ios: 'apple.com',
  jamf: 'jamf.com',
  'jamf pro': 'jamf.com',
  jira: 'atlassian.com',
  kafka: 'kafka.apache.org',
  kubernetes: 'kubernetes.io',
  linear: 'linear.app',
  linode: 'linode.com',
  macos: 'apple.com',
  mailchimp: 'mailchimp.com',
  microsoft: 'microsoft.com',
  'microsoft 365': 'microsoft.com',
  'microsoft azure': 'azure.microsoft.com',
  'microsoft defender': 'microsoft.com',
  'microsoft entra id': 'microsoft.com',
  'microsoft intune': 'microsoft.com',
  mongodb: 'mongodb.com',
  mysql: 'mysql.com',
  netlify: 'netlify.com',
  newrelic: 'newrelic.com',
  notion: 'notion.so',
  office: 'microsoft.com',
  'office 365': 'microsoft.com',
  okta: 'okta.com',
  oracle: 'oracle.com',
  'palo alto networks': 'paloaltonetworks.com',
  postgres: 'postgresql.org',
  postgresql: 'postgresql.org',
  prometheus: 'prometheus.io',
  proofpoint: 'proofpoint.com',
  redhat: 'redhat.com',
  'red hat': 'redhat.com',
  redis: 'redis.io',
  salesforce: 'salesforce.com',
  sendgrid: 'sendgrid.com',
  sentinelone: 'sentinelone.com',
  servicenow: 'servicenow.com',
  shopify: 'shopify.com',
  slack: 'slack.com',
  snowflake: 'snowflake.com',
  splunk: 'splunk.com',
  stripe: 'stripe.com',
  terraform: 'terraform.io',
  twilio: 'twilio.com',
  ubuntu: 'ubuntu.com',
  vercel: 'vercel.com',
  vmware: 'vmware.com',
  windows: 'microsoft.com',
  'windows 10': 'microsoft.com',
  'windows 11': 'microsoft.com',
  workday: 'workday.com',
  zscaler: 'zscaler.com',
  zendesk: 'zendesk.com',
  zoom: 'zoom.us',
};

interface TechLogoProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function TechLogo({ name, size = 14, className, style }: TechLogoProps) {
  const domain = domainFor(name);
  const [failed, setFailed] = useState(false);

  if (!domain || failed) {
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

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${Math.max(16, size * 2)}`}
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

function domainFor(name: string): string | null {
  const key = name.trim().toLowerCase();
  return DOMAIN_MAP[key] ?? null;
}
