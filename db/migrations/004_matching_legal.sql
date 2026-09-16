-- Migration: 004_matching_legal
-- Date: 2026-09-16
-- Description: Match scores + notifications + trilingual legal documents (ToS/Privacy) with Jobboard (Jobboerse) not Vermittlung disclaimer (§1 GewO); GDPR/EU Pay Transparency notes
-- Design reference: dach-china-tech-jobboard-design/supabase/migrations/00001_initial_schema.sql (tables legal_documents, match_scores, notifications — minimal port)
-- Legal reference: design doc §7 (7.1 Jobboerse vs Vermittlung, 7.2 GDPR, 7.3 PIPL, 7.4 trilingual docs, 7.5 Pay Transparency)
-- Dependencies: 001_init.sql (jobs), 003_candidate_features.sql (candidate_profiles), auth.users
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING
-- Apply: Supabase SQL editor (DO NOT auto-apply from scripts; no DB execution in this change)

-- ---------------------------------------------------------------------------
-- legal_documents — trilingual ToS/privacy/DPA/cookie texts, versioned
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_documents (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('tos','privacy','dpa','cookie_policy')),
  title_de TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_zh TEXT NOT NULL,
  content_de TEXT NOT NULL,
  content_en TEXT NOT NULL,
  content_zh TEXT NOT NULL,
  version TEXT NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (type, version)
);

-- ---------------------------------------------------------------------------
-- match_scores — candidate x job fit (hard filters + soft score)
-- candidate_id -> candidate_profiles(user_id); job_posting_id -> jobs(id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_scores (
  id SERIAL PRIMARY KEY,
  candidate_id UUID REFERENCES candidate_profiles(user_id) ON DELETE CASCADE,
  job_posting_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score >= 0 AND score <= 100),
  match_reasons TEXT[] DEFAULT '{}',
  hard_filter_pass BOOLEAN DEFAULT TRUE,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (candidate_id, job_posting_id)
);

-- ---------------------------------------------------------------------------
-- notifications — minimal in-app/email/wechat alert rows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('new_job_match','application_status_update','new_message','contact_request','weekly_digest')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('email','wechat_push','in_app')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_match_scores_candidate_id ON match_scores(candidate_id);
CREATE INDEX IF NOT EXISTS idx_match_scores_job_posting_id ON match_scores(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_match_scores_score ON match_scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_legal_documents_type ON legal_documents(type);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- legal_documents: publicly readable (ToS/privacy must be visible pre-login), writes via service_role
DROP POLICY IF EXISTS "Allow public read on legal_documents" ON legal_documents;
CREATE POLICY "Allow public read on legal_documents"
  ON legal_documents FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow service_role all on legal_documents" ON legal_documents;
CREATE POLICY "Allow service_role all on legal_documents"
  ON legal_documents FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- match_scores: owner + service_role
DROP POLICY IF EXISTS "Users can manage own match scores" ON match_scores;
CREATE POLICY "Users can manage own match scores"
  ON match_scores FOR ALL
  TO authenticated
  USING (auth.uid() = candidate_id)
  WITH CHECK (auth.uid() = candidate_id);

DROP POLICY IF EXISTS "Allow service_role all on match_scores" ON match_scores;
CREATE POLICY "Allow service_role all on match_scores"
  ON match_scores FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- notifications: owner + service_role
DROP POLICY IF EXISTS "Users can manage own notifications" ON notifications;
CREATE POLICY "Users can manage own notifications"
  ON notifications FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow service_role all on notifications" ON notifications;
CREATE POLICY "Allow service_role all on notifications"
  ON notifications FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Seeds: ToS + Privacy Policy v1.0, trilingual (DE/EN/ZH), short-form
-- Core statement (§7.1): platform is a Jobboerse (job board), NOT a
-- Vermittlung (recruitment agency); no mediation of employment
-- relationships; no Vermittlungserlaubnis (§1 GewO) claimed or required.
-- GDPR note (§7.2), PIPL scoping note (§7.3), EU Pay Transparency note (§7.5).
-- Full lawyer-reviewed texts still TODO — see docs/legal/IMPRINT-PRIVACY-TODO.md.
-- Replace [PLACEHOLDERS] before publishing.
-- ---------------------------------------------------------------------------
INSERT INTO legal_documents (type, title_de, title_en, title_zh, content_de, content_en, content_zh, version, effective_date)
VALUES (
  'tos',
  'Nutzungsbedingungen v1.0 (Kurzfassung)',
  'Terms of Service v1.0 (Short version)',
  '服务条款 v1.0（简版）',
  $$§1 Plattform-Status (Jobbörse, keine Vermittlung). Diese Plattform ist eine Jobbörse: Sie veröffentlicht Stellenanzeigen und ermöglicht die direkte Kontaktaufnahme zwischen Kandidaten und Arbeitgebern. Sie ist KEINE Arbeits- bzw. Stellenvermittlung (Vermittlung) und vermittelt KEINE Arbeitsverhältnisse. Es ist keine Vermittlungserlaubnis nach §1 GewO erforderlich oder beansprucht. §2 Leistungen. Arbeitgeber können Stellenanzeigen veröffentlichen (mit Gehaltsangabe gemäss EU-Entgelttransparenzrichtlinie); Kandidaten können Profile anlegen und sich direkt bewerben. §3 Pflichten. Nutzer geben wahrheitsgemässe Angaben; Arbeitgeber verantworten Inhalt und Rechtmässigkeit ihrer Anzeigen (inkl. Gehaltsangaben). §4 Haftung. Die Plattform haftet nicht für den Erfolg von Bewerbungen oder Einstellungen. §5 Änderungen. Wesentliche Änderungen werden 14 Tage vorab angekündigt. Anbieter: [Firmenname GmbH, Adresse, HRB, Geschäftsführer]. Stand: Kurzfassung — die anwaltlich geprüfte Vollversion folgt.$$
  ,
  $$Section 1 — Platform status (job board, not an agency). This platform is a job board (Jobbörse): it publishes job ads and lets candidates and employers contact each other directly. It is NOT a recruitment agency (Vermittlung) and does NOT mediate employment relationships. No agency licence under §1 GewO (German Trade Regulation Act) is required or claimed. Section 2 — Services. Employers may post jobs (with salary disclosure per the EU Pay Transparency Directive); candidates may create profiles and apply directly. Section 3 — Duties. Users provide truthful information; employers are responsible for the content and legality of their ads (including salary figures). Section 4 — Liability. The platform is not liable for hiring outcomes. Section 5 — Changes. Material changes are announced 14 days in advance. Provider: [Company GmbH, address, HRB, managing director]. Note: short version — full lawyer-reviewed text to follow.$$
  ,
  $$第1条 平台性质（招聘信息板，非中介）。本平台为求职信息板（Jobbörse）：仅发布招聘信息、促成候选人与雇主直接联系。本平台不是职业中介/劳务中介（Vermittlung），不居间缔结劳动关系；不要求亦不主张德国《营业条例》第1条（§1 GewO）项下的中介许可。第2条 服务。雇主可发布职位（含按欧盟薪酬透明指令披露的薪资）；候选人可创建简历并直接投递。第3条 义务。用户须提供真实信息；雇主对其广告内容与合法性（含薪资数据）负责。第4条 责任。平台不对求职或录用结果承担责任。第5条 变更。重大变更提前14天公告。运营方：[公司名称 GmbH、地址、HRB、总经理]。注：此为简版，律师审定完整版待后续发布。$$
  ,
  'v1.0',
  CURRENT_DATE
)
ON CONFLICT (type, version) DO NOTHING;

INSERT INTO legal_documents (type, title_de, title_en, title_zh, content_de, content_en, content_zh, version, effective_date)
VALUES (
  'privacy',
  'Datenschutzerklärung v1.0 (Kurzfassung)',
  'Privacy Policy v1.0 (Short version)',
  '隐私政策 v1.0（简版）',
  $$§1 Verantwortlicher. [Firmenname GmbH, Adresse, E-Mail] — Anfragen an [datenschutz@beispiel.de]. §2 Daten & Zwecke. Konto- und Profildaten (u.a. Lebenslauf, Sprachkenntnisse, Visa-Status), Stellenanzeigen, Nutzungs- und Matching-Daten — nur so viel wie für Matching nötig (Datenminimierung, Art. 5 DSGVO). Rechtsgrundlagen: Vertrag (Art. 6 Abs. 1 lit. b), Einwilligung (lit. a), berechtigtes Interesse an sicherem Betrieb (lit. f). §3 Empfänger. Arbeitgeber sehen nur Kandidatenprofile mit sichtbarer Freigabe; Subprozessoren: Hosting/Datenbank (Vercel, Supabase, EU-Region). §4 Drittland/PIPL. Die Plattform richtet sich an Kandidaten in der DACH-Region; Registrierungen aus China erfordern eine gesonderte Einwilligung in den Datentransfer (PIPL-Grenzübertritt). §5 Rechte & Löschung. Auskunft, Berichtigung, Löschung, Einschränkung, Übertragbarkeit, Widerspruch, Widerruf; Beschwerde bei der Aufsichtsbehörde. Kontolöschung anonymisiert Profildaten; Finanzunterlagen bleiben 7 Jahre (Aufbewahrungspflicht). §6 Cookies. Nur technisch notwendige Cookies ohne Banner; Tracking erst nach Einwilligung. Stand: Kurzfassung — Vollversion (mit Auftragsverarbeitungsvertrag für Arbeitgeber) folgt.$$
  ,
  $$Section 1 — Controller. [Company GmbH, address, email] — privacy contact: [privacy@example.com]. Section 2 — Data & purposes. Account and profile data (incl. CV, language skills, visa status), job ads, usage and matching data — only what matching needs (data minimisation, GDPR Art. 5). Legal bases: contract (Art. 6(1)(b)), consent (a), legitimate interest in secure operation (f). Section 3 — Recipients. Employers only see candidate profiles explicitly set visible; subprocessors: hosting/database (Vercel, Supabase, EU region). Section 4 — Third countries / PIPL. The platform targets candidates in the DACH region; sign-ups from China require separate cross-border transfer consent (PIPL). Section 5 — Rights & erasure. Access, rectification, erasure, restriction, portability, objection, withdrawal; complaint to the supervisory authority. Account deletion anonymises profile data; financial records are kept 7 years (statutory retention). Section 6 — Cookies. Strictly necessary cookies only without a banner; tracking only after consent. Note: short version — full text (with employer DPA) to follow.$$
  ,
  $$第1条 控制者。[公司名称 GmbH、地址、邮箱]；隐私联系：[privacy@example.com]。第2条 数据与目的。账户与简历数据（含简历、语言能力、签证状态）、职位信息、使用与匹配数据——仅收集匹配所必需（GDPR第5条最小化原则）。法律依据：合同履行（第6(1)(b)条）、同意（a项）、安全运营的正当利益（f项）。第3条 接收方。雇主仅可见候选人主动公开的简历；子处理者：托管/数据库（Vercel、Supabase，欧盟区域）。第4条 跨境/PIPL。本平台面向DACH地区候选人；来自中国大陆的注册须另行取得跨境传输同意（《个人信息保护法》）。第5条 权利与删除。查阅、更正、删除、限制、可携带、反对、撤回同意，并可向监管机构投诉。注销即匿名化简历数据；财务记录依法保留7年。第6条 Cookie。仅使用严格必要Cookie；追踪类须经同意。注：此为简版，完整版（含面向雇主的数据处理协议DPA）待后续发布。$$
  ,
  'v1.0',
  CURRENT_DATE
)
ON CONFLICT (type, version) DO NOTHING;
