# Email 01 — Fieldfisher Paris: Legal Review Request

**To:** partner@fieldfisher.com  
**CC:** [Your in-house counsel if applicable]  
**Subject:** Request for Legal Review — BidStack 360° SaaS CRM (DPA / ToS / Privacy / MSA)  
**Language:** French  

---

## Body

Monsieur / Madame,

Je me permets de vous contacter suite à la recommandation de votre cabinet pour les engagements liés aux contrats SaaS dans le domaine du droit des données et du numérique.

**Contexte du projet**

BidStack 360° est une plateforme CRM SaaS B2B développée par Mantu Group, destinée à gérer les pipelines commerciaux et les appels d'offres de nos clients entreprises. Nous sommes actuellement en phase de préparation au lancement commercial et souhaitons soumettre nos documents contractuels à une revue juridique complète avant toute mise en production.

**Données de cadrage :**
- Environ 100 clients entreprises initiaux, principalement en Europe (FR, DE, UK, BE, CH) et aux États-Unis
- Traitement de données personnelles (PII) : contacts commerciaux, coordonnées, historique d'activité pipeline
- Résidences des données : UE (Scaleway / AWS eu-west) et US-East (AWS us-east-1)
- Sous-traitants principaux : Clerk (auth), Stripe (paiement), Resend (email transactionnel), DocuSign (signatures électroniques)
- Conformité cible : RGPD, CCPA, SCCs (Standard Contractual Clauses), ePrivacy

**Documents à réviser**

Nous soumettons quatre documents pour revue :

1. **Conditions Générales d'Utilisation (ToS)** — disponible à : `apps/marketing/src/pages/legal/terms.astro` (version draft)
2. **Politique de Confidentialité (Privacy Policy)** — `apps/marketing/src/pages/legal/privacy.astro`
3. **Accord de Traitement des Données (DPA)** — `apps/marketing/src/pages/legal/dpa.astro`
4. **Accord-Cadre de Services (MSA)** — `apps/marketing/src/pages/legal/security.astro` (à renommer MSA)

> **Note :** ces pages sont en draft interne non publié. Je vous transmettrai les PDF compilés en pièce jointe sur demande de votre part.

**Périmètre de la revue demandée**

- Conformité RGPD (art. 13/14 notices, bases légales, clauses DPA art. 28)
- Transferts internationaux : SCC Module 2 (responsable → sous-traitant) avec les sous-traitants US
- Clauses de responsabilité et de limitation, notamment pour le traitement de données de personnes morales vs personnes physiques
- Gouvernance des données en cas de résiliation : rétention, portabilité, destruction
- Clauses d'audit et de sécurité dans le DPA
- Revue de l'accord MSA : structure tarifaire, pénalités SLA, propriété intellectuelle

**Demande**

Pourriez-vous nous fournir :
1. Un **devis à prix fixe** (forfait) pour la revue complète des quatre documents
2. Une estimation du **délai de rendu** (nous ciblons la remise des commentaires sous 3 semaines)
3. La composition de **l'équipe** qui interviendrait (data privacy + commercial/SaaS)

Nous sommes également ouverts à une structuration en deux lots si vous le préférez : (i) RGPD/DPA et (ii) CGU/MSA commerciales.

Je suis disponible pour un appel de 30 minutes cette semaine ou la semaine prochaine pour vous briefer plus en détail.

Dans l'attente de votre retour,

Bien cordialement,

**<Your Name>**  
BidStack 360° / Mantu Group  
<your.email@mantu.com>  
+33 [X XX XX XX XX]

---

*Ce message peut contenir des informations confidentielles. Si vous n'êtes pas le destinataire prévu, veuillez nous en informer immédiatement et détruire ce message.*
