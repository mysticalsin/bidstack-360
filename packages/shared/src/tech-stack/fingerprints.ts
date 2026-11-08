/**
 * Curated technology fingerprints for open data detection (slice 16).
 *
 * Written for Polo and covered by the repository licence. No third-party
 * fingerprint set is vendored: the maintained community Wappalyzer fork is
 * GPL-3.0 and the last permissive snapshots have unclear provenance, so this
 * file keeps a small, reviewed set of enterprise-relevant rules instead.
 *
 * Each rule lists the public signals that name one technology:
 *   mx, spf, txt, cname, ns  DNS records on the company's primary domain
 *   host                     certificate transparency host names
 *   html, script, header     the public homepage (one request)
 *   jobs                     public job posting titles, departments and skills
 * Patterns match lowercased input unless the rule says otherwise.
 */

export type TechCategory =
  | 'Cloud'
  | 'Collaboration'
  | 'Security'
  | 'Identity'
  | 'CRM'
  | 'Marketing'
  | 'ITSM'
  | 'Data'
  | 'Analytics'
  | 'ERP'
  | 'HR'
  | 'DevOps'
  | 'Web'
  | 'Commerce'
  | 'AI'
  | 'Languages';

export interface TechRule {
  name: string;
  category: TechCategory;
  mx?: RegExp[];
  spf?: RegExp[];
  txt?: RegExp[];
  cname?: RegExp[];
  ns?: RegExp[];
  /** Host names seen in certificate transparency logs. */
  host?: RegExp[];
  html?: RegExp[];
  script?: RegExp[];
  /** [lowercase header name, value pattern]. */
  header?: Array<[string, RegExp]>;
  /** Case-sensitive word patterns for job posting text. */
  jobs?: RegExp[];
}

/** Subdomain label (first label of a host under the company domain). */
const label = (...names: string[]) => new RegExp(`^(?:${names.join('|')})(?:[0-9-]|\\.)`);

export const TECH_RULES: TechRule[] = [
  // ─── Collaboration and email ───────────────────────────────────────────────
  {
    name: 'Microsoft 365',
    category: 'Collaboration',
    mx: [/\.mail\.protection\.outlook\.com\.?$/],
    spf: [/include:spf\.protection\.outlook\.com/],
    txt: [/^ms=ms\d+/],
    cname: [/autodiscover\.outlook\.com\.?$/, /webdir\.online\.lync\.com\.?$/, /sipdir\.online\.lync\.com\.?$/],
    host: [/\.sharepoint\.com$/, /\.onmicrosoft\.com$/],
  },
  {
    name: 'Google Workspace',
    category: 'Collaboration',
    mx: [/aspmx\.l\.google\.com\.?$/, /\.googlemail\.com\.?$/, /^smtp\.google\.com\.?$/],
    spf: [/include:_spf\.google\.com/],
  },
  { name: 'Microsoft Intune', category: 'Security', cname: [/enterpriseenrollment(?:-s)?\.manage\.microsoft\.com\.?$/] },
  { name: 'Microsoft Entra ID', category: 'Identity', cname: [/enterpriseregistration\.windows\.net\.?$/] },
  { name: 'Microsoft Exchange', category: 'Collaboration', host: [label('owa', 'exchange', 'webmail')] },
  { name: 'Microsoft SharePoint', category: 'Collaboration', host: [label('sharepoint', 'intranet-sp')] },
  { name: 'Slack', category: 'Collaboration', txt: [/^slack-domain-verification=/], host: [/\.slack\.com$/], jobs: [/\bSlack\b/] },
  { name: 'Zoom', category: 'Collaboration', txt: [/^zoom-domain-verification=/, /^zoom_verify_/], host: [/\.zoom\.us$/] },
  { name: 'Webex', category: 'Collaboration', txt: [/^webexdomainverification/, /^cisco-ci-domain-verification=/], host: [/\.webex\.com$/] },
  { name: 'Atlassian', category: 'DevOps', txt: [/^atlassian-domain-verification=/], spf: [/include:_spf\.atlassian\.net/], cname: [/\.atlassian\.net\.?$/], host: [/\.atlassian\.net$/] },
  { name: 'Jira', category: 'DevOps', host: [label('jira')], jobs: [/\bJira\b/] },
  { name: 'Confluence', category: 'DevOps', host: [label('confluence')], jobs: [/\bConfluence\b/] },
  { name: 'Atlassian Statuspage', category: 'DevOps', cname: [/\.stspg-customer\.com\.?$/] },
  { name: 'DocuSign', category: 'Collaboration', txt: [/^docusign=/], spf: [/include:[a-z0-9.]*docusign\.net/] },
  { name: 'Adobe', category: 'Marketing', txt: [/^adobe-idp-site-verification=/, /^adobe-sign-verification=/] },
  { name: 'Box', category: 'Collaboration', txt: [/^box-domain-verification=/], host: [/\.box\.com$/] },
  { name: 'Dropbox', category: 'Collaboration', txt: [/^dropbox-domain-verification=/] },
  { name: 'Miro', category: 'Collaboration', txt: [/^miro-verification=/] },

  // ─── Email security and delivery ───────────────────────────────────────────
  { name: 'Proofpoint', category: 'Security', mx: [/\.pphosted\.com\.?$/, /\.ppe-hosted\.com\.?$/], spf: [/include:[a-z0-9.]*pphosted\.com/] },
  { name: 'Mimecast', category: 'Security', mx: [/\.mimecast\.com\.?$/], spf: [/include:[a-z0-9.]*mimecast\.com/] },
  { name: 'Cisco Secure Email', category: 'Security', mx: [/\.iphmx\.com\.?$/] },
  { name: 'Broadcom Email Security', category: 'Security', mx: [/\.messagelabs\.com\.?$/], spf: [/include:spf\.messagelabs\.com/] },
  { name: 'Barracuda', category: 'Security', mx: [/\.barracudanetworks\.com\.?$/] },
  { name: 'Trend Micro Email Security', category: 'Security', mx: [/\.tmes\.trendmicro\.(?:com|eu)\.?$/] },
  { name: 'KnowBe4', category: 'Security', txt: [/^knowbe4-site-verification=/] },
  { name: 'SendGrid', category: 'Marketing', spf: [/include:sendgrid\.net/], cname: [/\.sendgrid\.net\.?$/] },
  { name: 'Mailchimp', category: 'Marketing', spf: [/include:servers\.mcsv\.net/] },
  { name: 'Amazon SES', category: 'Cloud', spf: [/include:amazonses\.com/], txt: [/^amazonses:/] },

  // ─── Identity and security ─────────────────────────────────────────────────
  { name: 'Okta', category: 'Identity', cname: [/\.okta(?:-emea)?\.com\.?$/], host: [/\.okta(?:-emea|preview)?\.com$/], jobs: [/\bOkta\b/] },
  { name: 'Microsoft AD FS', category: 'Identity', host: [label('adfs', 'sts')] },
  { name: 'Ping Identity', category: 'Identity', host: [/\.pingone\.(?:com|eu)$/], jobs: [/\bPing ?(?:Identity|Federate)\b/] },
  { name: 'OneTrust', category: 'Security', txt: [/^onetrust-domain-verification=/], script: [/cdn\.cookielaw\.org/, /optanon/] },
  { name: 'Cookiebot', category: 'Security', script: [/consent\.cookiebot\.com/] },
  { name: 'Citrix', category: 'Security', txt: [/^citrix-verification-code=/], host: [label('citrix', 'ctx', 'storefront')], jobs: [/\bCitrix\b/] },
  { name: 'Palo Alto Networks', category: 'Security', host: [label('globalprotect')], jobs: [/\bPalo Alto\b/, /\bPrisma (?:Access|Cloud)\b/] },
  { name: 'Fortinet', category: 'Security', host: [label('fortigate', 'fortivpn', 'fortinet')], jobs: [/\bFortinet\b/, /\bFortiGate\b/] },
  { name: 'Cisco AnyConnect', category: 'Security', host: [label('anyconnect')] },
  { name: 'CrowdStrike', category: 'Security', jobs: [/\bCrowdStrike\b/] },
  { name: 'Splunk', category: 'Security', host: [label('splunk')], jobs: [/\bSplunk\b/] },
  { name: 'Microsoft Sentinel', category: 'Security', jobs: [/\b(?:Microsoft|Azure) Sentinel\b/] },
  { name: 'Zscaler', category: 'Security', jobs: [/\bZscaler\b/] },

  // ─── Cloud, DNS and delivery ───────────────────────────────────────────────
  { name: 'Cloudflare', category: 'Cloud', ns: [/\.ns\.cloudflare\.com\.?$/], header: [['server', /^cloudflare/], ['cf-ray', /./]] },
  { name: 'Amazon Web Services', category: 'Cloud', ns: [/\.awsdns-\d+\./], cname: [/\.cloudfront\.net\.?$/, /\.elb\.amazonaws\.com\.?$/, /\.s3[.-][a-z0-9-]*\.?amazonaws\.com\.?$/], header: [['x-amz-cf-id', /./], ['server', /^amazons3$/]], jobs: [/\bAWS\b/, /\bAmazon Web Services\b/] },
  { name: 'Microsoft Azure', category: 'Cloud', ns: [/\.azure-dns\.(?:com|net|org|info)\.?$/], cname: [/\.azurewebsites\.net\.?$/, /\.azureedge\.net\.?$/, /\.azurefd\.net\.?$/, /\.cloudapp\.(?:net|azure\.com)\.?$/, /\.trafficmanager\.net\.?$/], header: [['x-azure-ref', /./]], jobs: [/\bAzure\b/] },
  { name: 'Google Cloud', category: 'Cloud', cname: [/ghs\.googlehosted\.com\.?$/, /\.appspot\.com\.?$/], header: [['via', /\bgoogle\b/]], jobs: [/\bGCP\b/, /\bGoogle Cloud\b/, /\bBigQuery\b/] },
  { name: 'Akamai', category: 'Cloud', ns: [/\.akam\.net\.?$/], cname: [/\.edgekey\.net\.?$/, /\.akamaiedge\.net\.?$/, /\.edgesuite\.net\.?$/], header: [['x-akamai-transformed', /./], ['server', /^akamaighost/]] },
  { name: 'Fastly', category: 'Cloud', cname: [/\.fastly\.net\.?$/, /\.fastlylb\.net\.?$/], header: [['x-served-by', /^cache-/], ['fastly-debug-digest', /./]] },
  { name: 'Vercel', category: 'Cloud', cname: [/\.vercel-dns\.com\.?$/], header: [['x-vercel-id', /./]] },
  { name: 'Netlify', category: 'Cloud', cname: [/\.netlify\.app\.?$/], header: [['x-nf-request-id', /./]] },
  { name: 'Imperva', category: 'Security', cname: [/\.incapdns\.net\.?$/], header: [['x-iinfo', /./]] },
  { name: 'Kubernetes', category: 'DevOps', host: [label('k8s', 'kubernetes', 'rancher', 'argocd')], jobs: [/\bKubernetes\b/, /\bK8s\b/, /\bAKS\b/, /\bEKS\b/, /\bOpenShift\b/] },
  { name: 'Terraform', category: 'DevOps', jobs: [/\bTerraform\b/] },
  { name: 'Docker', category: 'DevOps', jobs: [/\bDocker\b/] },
  { name: 'GitLab', category: 'DevOps', host: [label('gitlab')], jobs: [/\bGitLab\b/] },
  { name: 'GitHub', category: 'DevOps', jobs: [/\bGitHub\b/] },
  { name: 'Jenkins', category: 'DevOps', host: [label('jenkins')], jobs: [/\bJenkins\b/] },
  { name: 'JFrog Artifactory', category: 'DevOps', host: [label('artifactory')], jobs: [/\bArtifactory\b/] },
  { name: 'VMware', category: 'Cloud', host: [label('vcenter', 'vsphere')], jobs: [/\bVMware\b/, /\bvSphere\b/] },

  // ─── CRM, marketing and support ────────────────────────────────────────────
  { name: 'Salesforce', category: 'CRM', spf: [/include:_spf\.salesforce\.com/], cname: [/\.force\.com\.?$/, /\.salesforce-sites\.com\.?$/, /\.my\.site\.com\.?$/], host: [/\.my\.salesforce\.com$/, /\.lightning\.force\.com$/, /\.my\.site\.com$/, label('salesforce', 'sfdc')], jobs: [/\bSalesforce\b/] },
  { name: 'Salesforce Marketing Cloud', category: 'Marketing', spf: [/include:cust-spf\.exacttarget\.com/], cname: [/\.exacttarget\.com\.?$/] },
  { name: 'Pardot', category: 'Marketing', cname: [/go\.pardot\.com\.?$/], script: [/pi\.pardot\.com/] },
  { name: 'HubSpot', category: 'Marketing', txt: [/^hubspot-developer-verification=/], spf: [/include:[a-z0-9.]*hubspotemail\.net/], cname: [/\.hubspot\.net\.?$/, /\.hs-sites\.com\.?$/], script: [/js\.hs-scripts\.com/, /js\.hsforms\.net/, /js\.hs-analytics\.net/], jobs: [/\bHubSpot\b/] },
  { name: 'Marketo', category: 'Marketing', spf: [/include:mktomail\.com/], cname: [/\.mktoweb\.com\.?$/, /\.mktossl\.com\.?$/], script: [/munchkin\.marketo\.net/], jobs: [/\bMarketo\b/] },
  { name: 'Oracle Eloqua', category: 'Marketing', spf: [/include:_spf\.en25\.com/], script: [/\.en25\.com/, /elqcfg/] },
  { name: 'Microsoft Dynamics 365', category: 'CRM', host: [/\.crm\d*\.dynamics\.com$/], script: [/mktdplp\d*cdn\.azureedge\.net/, /\.dynamics\.com\/[a-z]+\/form/], jobs: [/\bDynamics 365\b/, /\bD365\b/] },
  { name: 'Zendesk', category: 'ITSM', spf: [/include:mail\.zendesk\.com/], cname: [/\.zendesk\.com\.?$/], host: [/\.zendesk\.com$/], script: [/static\.zdassets\.com/] },
  { name: 'Freshdesk', category: 'ITSM', spf: [/include:[a-z0-9.]*freshdesk\.com/], cname: [/\.freshdesk\.com\.?$/] },
  { name: 'ServiceNow', category: 'ITSM', cname: [/\.service-now\.com\.?$/], host: [/\.service-now\.com$/, label('servicenow')], jobs: [/\bServiceNow\b/] },
  { name: 'Intercom', category: 'ITSM', script: [/widget\.intercom\.io/, /js\.intercomcdn\.com/] },
  { name: 'Qualtrics', category: 'Analytics', script: [/siteintercept\.qualtrics\.com/] },
  { name: 'Meta Pixel', category: 'Marketing', txt: [/^facebook-domain-verification=/], script: [/connect\.facebook\.net\/[a-z_]+\/fbevents\.js/] },
  { name: 'LinkedIn Insight Tag', category: 'Marketing', script: [/snap\.licdn\.com/] },

  // ─── Analytics and tag management ──────────────────────────────────────────
  { name: 'Google Tag Manager', category: 'Analytics', script: [/googletagmanager\.com\/gtm\.js/, /googletagmanager\.com\/ns\.html/] },
  { name: 'Google Analytics', category: 'Analytics', script: [/googletagmanager\.com\/gtag\/js/, /google-analytics\.com\/(?:analytics|ga)\.js/] },
  { name: 'Adobe Analytics', category: 'Analytics', script: [/\.omtrdc\.net/, /appmeasurement(?:\.min)?\.js/, /s_code\.js/] },
  { name: 'Adobe Experience Platform Launch', category: 'Analytics', script: [/assets\.adobedtm\.com/] },
  { name: 'Tealium', category: 'Analytics', script: [/tags\.tiqcdn\.com/] },
  { name: 'Segment', category: 'Analytics', script: [/cdn\.segment\.com/] },
  { name: 'Hotjar', category: 'Analytics', script: [/static\.hotjar\.com/] },
  { name: 'Microsoft Clarity', category: 'Analytics', script: [/www\.clarity\.ms\/tag/] },
  { name: 'Contentsquare', category: 'Analytics', script: [/t\.contentsquare\.net/] },
  { name: 'Optimizely', category: 'Analytics', script: [/cdn\.optimizely\.com/] },
  { name: 'Dynatrace', category: 'Analytics', script: [/ruxitagentjs/, /js-cdn\.dynatrace\.com/], header: [['x-oneagent-js-injection', /./]], jobs: [/\bDynatrace\b/] },
  { name: 'New Relic', category: 'Analytics', script: [/js-agent\.newrelic\.com/], html: [/nreum/], jobs: [/\bNew Relic\b/] },
  { name: 'Datadog', category: 'Analytics', script: [/datadoghq-browser-agent/, /www\.datadoghq-browser-agent\.com/], jobs: [/\bDatadog\b/] },
  { name: 'Power BI', category: 'Data', host: [label('powerbi')], jobs: [/\bPower ?BI\b/] },
  { name: 'Tableau', category: 'Data', host: [label('tableau')], jobs: [/\bTableau\b/] },
  { name: 'Grafana', category: 'Analytics', host: [label('grafana')], jobs: [/\bGrafana\b/] },
  { name: 'Elastic', category: 'Data', host: [label('kibana', 'elastic')], jobs: [/\bElasticsearch\b/, /\bKibana\b/] },

  // ─── Web platform and commerce ─────────────────────────────────────────────
  { name: 'Adobe Experience Manager', category: 'Web', html: [/\/etc\.clientlibs\//, /\/content\/dam\//], jobs: [/\bAEM\b/, /\bAdobe Experience Manager\b/] },
  { name: 'Sitecore', category: 'Web', html: [/\/-\/media\//, /sitecore/], jobs: [/\bSitecore\b/] },
  { name: 'Optimizely CMS', category: 'Web', html: [/episerver/, /epi-/], jobs: [/\bEPiServer\b/, /\bOptimizely CMS\b/] },
  { name: 'Drupal', category: 'Web', html: [/drupal-settings-json/, /\/sites\/default\/files\//, /<meta name="generator" content="drupal/], header: [['x-generator', /^drupal/], ['x-drupal-cache', /./]] },
  { name: 'WordPress', category: 'Web', html: [/\/wp-content\//, /\/wp-includes\//], cname: [/\.wpengine\.com\.?$/] },
  { name: 'Contentful', category: 'Web', html: [/images\.ctfassets\.net/] },
  { name: 'Next.js', category: 'Web', html: [/<script id="__next_data__"/, /\/_next\/static\//], header: [['x-powered-by', /^next\.js/]] },
  { name: 'Angular', category: 'Web', html: [/ng-version="/], jobs: [/\bAngular\b/] },
  { name: 'React', category: 'Web', html: [/data-reactroot/, /react-dom(?:\.production)?(?:\.min)?\.js/], jobs: [/\bReact\b/] },
  { name: 'Shopify', category: 'Commerce', cname: [/\.myshopify\.com\.?$/, /shops\.myshopify\.com\.?$/], script: [/cdn\.shopify\.com/] },
  { name: 'Salesforce Commerce Cloud', category: 'Commerce', html: [/\/on\/demandware\.static\//, /demandware\.net/] },
  { name: 'SAP Commerce Cloud', category: 'Commerce', html: [/\/_ui\/responsive\//, /yacceleratorstorefront/] },
  { name: 'Stripe', category: 'Commerce', txt: [/^stripe-verification=/], script: [/js\.stripe\.com/] },

  // ─── Data, ERP, HR ─────────────────────────────────────────────────────────
  { name: 'SAP', category: 'ERP', host: [label('sap', 'fiori', 's4hana')], jobs: [/\bSAP\b/, /\bS\/4 ?HANA\b/, /\bSAP (?:BTP|ECC|FICO|MM|SD|BW)\b/] },
  { name: 'SAP SuccessFactors', category: 'HR', host: [/\.successfactors\.(?:com|eu)$/], jobs: [/\bSuccessFactors\b/] },
  { name: 'Workday', category: 'HR', cname: [/\.myworkdayjobs\.com\.?$/], host: [/\.myworkdayjobs\.com$/, /\.myworkday\.com$/, label('workday')], jobs: [/\bWorkday\b/] },
  { name: 'Oracle', category: 'ERP', jobs: [/\bOracle (?:EBS|E-Business|Fusion|Cloud ERP|Database|DB)\b/, /\bPL\/SQL\b/] },
  { name: 'Microsoft Dynamics 365 Finance', category: 'ERP', jobs: [/\bDynamics 365 (?:Finance|F&O|Business Central)\b/] },
  { name: 'Snowflake', category: 'Data', jobs: [/\bSnowflake\b/] },
  { name: 'Databricks', category: 'Data', jobs: [/\bDatabricks\b/] },
  { name: 'Apache Spark', category: 'Data', jobs: [/\bApache Spark\b/, /\bPySpark\b/, /\bSpark SQL\b/] },
  { name: 'Apache Kafka', category: 'Data', jobs: [/\bKafka\b/] },
  { name: 'Informatica', category: 'Data', jobs: [/\bInformatica\b/] },
  { name: 'MuleSoft', category: 'Data', jobs: [/\bMuleSoft\b/] },
  { name: 'MongoDB', category: 'Data', txt: [/^mongodb-site-verification=/], jobs: [/\bMongoDB\b/] },
  { name: 'Azure OpenAI', category: 'AI', jobs: [/\bAzure OpenAI\b/] },
  { name: 'Guidewire', category: 'ERP', jobs: [/\bGuidewire\b/] },
  { name: 'Temenos', category: 'ERP', jobs: [/\bTemenos\b/, /\bT24\b/] },
  { name: 'Epic', category: 'ERP', jobs: [/\bEpic (?:Systems|EHR|certified|certification|analyst|Hyperspace)\b/] },
  { name: 'Siemens Teamcenter', category: 'ERP', jobs: [/\bTeamcenter\b/] },
  { name: 'Dassault 3DEXPERIENCE', category: 'ERP', jobs: [/\b3DEXPERIENCE\b/, /\bCATIA\b/] },

  // ─── Languages (job postings) ──────────────────────────────────────────────
  { name: 'Python', category: 'Languages', jobs: [/\bPython\b/] },
  { name: 'Java', category: 'Languages', jobs: [/\bJava\b(?!Script)/] },
  { name: '.NET', category: 'Languages', jobs: [/(?:^|\s)\.NET\b/, /\bC#/] },
];

export const TECH_RULE_COUNT = TECH_RULES.length;
