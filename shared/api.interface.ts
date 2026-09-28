export type CompanyStatus =
  | 'pending'
  | 'analyzing'
  | 'analyzed'
  | 'generating'
  | 'generated'
  | 'no_email'
  | 'failed';

export interface ContactStatus {
  whatsappContactedAt?: string | null;
  viberContactedAt?: string | null;
  emailContactedAt?: string | null;
}

export type StatsFilterKey =
  | 'all'
  | 'starred'
  | 'analyzed'
  | 'pending'
  | 'generated'
  | 'no_email'
  | 'failed';

export interface Company {
  id: string;
  projectId: string | null;
  seqNo: number | null;
  name: string;
  country: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  verifyStatus: string | null;
  source: string | null;
  latitude: number | null;
  longitude: number | null;
  status: CompanyStatus;
  websiteSummary: string | null;
  websiteLanguage: string | null;
  websiteBusinessType: string | null;
  websiteProducts: string | null;
  websiteScale: string | null;
  websiteCity: string | null;
  websiteHighlights: string | null;
  websiteImpression: string | null;
  websiteSizeImpression: string | null;
  websiteContactEmail: string | null;
  websiteContactPhone: string | null;
  websiteSocial: string | null;
  websiteHours: string | null;
  analyzeError: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  emailSubjectLocal: string | null;
  emailBodyLocal: string | null;
  emailLanguage: string | null;
  generateError: string | null;
  whatsappPhone: string | null;
  whatsappMessage: string | null;
  whatsappMessageLocal: string | null;
  importBatchId: string | null;
  isStarred: boolean;
  contactStatus: ContactStatus;
  normalizedPhone: string | null;
  phoneType: 'mobile' | 'landline' | 'unknown' | null;
  normalizedWhatsappPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyListParams {
  projectId: string;
  page?: number;
  pageSize?: number;
  status?: CompanyStatus;
  search?: string;
  noEmail?: boolean;
  isStarred?: boolean;
  filterKey?: StatsFilterKey;
}

export interface CompanyListResponse {
  items: Company[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompanyStatsResponse {
  total: number;
  analyzed: number;
  generated: number;
  noEmail: number;
  failed: number;
  starred: number;
  pending: number;
  hasPhone: number;
  hasWhatsapp: number;
}

export interface ImportResult {
  total: number;
  success: number;
  missingWebsite: number;
  missingEmail: number;
  missingPhone: number;
  mode: 'append' | 'overwrite';
  unrecognizedColumns: string[];
  rowErrors?: string[];
}

export interface ImportByBase64Request {
  projectId: string;
  mode: 'append' | 'overwrite';
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export interface UploadMaterialByBase64Request {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  companyCount: number;
  generatedCount: number;
  materials: ProjectMaterial[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMaterial {
  id: string;
  projectId: string;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  contentSummary: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface CreateProjectRequest {
  name: string;
  description: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
}

export interface SenderConfig {
  id: string;
  senderName: string;
  senderTitle: string | null;
  personalStory: string | null;
}

export interface UpdateSenderConfigRequest {
  senderName?: string;
  senderTitle?: string;
  personalStory?: string;
}

export interface ModelConfig {
  id: string;
  apiBaseUrl: string;
  apiKey?: string;
  apiKeySet: boolean;
  modelName: string;
  temperature: number | null;
  emailLanguage: string;
  senderSignature: string;
}

export interface UpdateModelConfigRequest {
  apiBaseUrl?: string;
  apiKey?: string;
  modelName?: string;
  temperature?: number | null;
  emailLanguage?: string;
  senderSignature?: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message?: string;
}

export interface DuplicateGroup {
  groupKey: string;
  matchFields: ('name' | 'email' | 'website')[];
  companies: Company[];
}

export interface DuplicateCheckResponse {
  groups: DuplicateGroup[];
  totalDuplicates: number;
}

export interface BatchDeleteRequest {
  ids: string[];
}

export interface AnalyzeWebsiteRequest {
  companyId: string;
}

export interface BatchAnalyzeRequest {
  companyIds?: string[];
  projectId?: string;
}

export interface GenerateEmailRequest {
  companyId: string;
}

export interface BatchGenerateRequest {
  companyIds?: string[];
  projectId?: string;
}

export interface BatchWhatsAppRequest {
  projectId: string;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
  subjectLocal: string;
  bodyLocal: string;
  languageCode: string;
  summary: string;
}

export interface UpdateEmailRequest {
  subject: string;
  body: string;
}

export interface EmlDownloadResponse {
  emlContent: string;
  fileName: string;
}

export interface WhatsAppInfo {
  available: boolean;
  internationalPhone: string | null;
  messageText: string | null;
  messageTextLocal: string | null;
  languageCode: string | null;
}

// --- Email Threads ---

export interface EmailThread {
  id: string;
  companyId: string;
  projectId: string;
  threadDate: string;
  content: string;
  direction: 'inbound' | 'outbound' | 'note';
  createdAt: string;
}

export interface EmailThreadListResponse {
  items: EmailThread[];
  total: number;
}

export interface CreateEmailThreadRequest {
  companyId: string;
  projectId: string;
  threadDate: string;
  content: string;
  direction?: 'inbound' | 'outbound' | 'note';
}

// --- Auto Import ---

export interface ImportSecretConfig {
  importSecretSet: boolean;
  importSecretMasked: string | null;
}

export interface UpdateImportSecretRequest {
  importSecret: string;
}

export interface AutoImportLead {
  seqNo?: number | null;
  name?: string | null;
  country?: string | null;
  address?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  verifyStatus?: string | null;
  source?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface AutoImportRequest {
  projectName: string;
  leads: AutoImportLead[];
}

export interface AutoImportResponse {
  projectId: string;
  projectUrl: string;
  imported: number;
  duplicates: number;
}

// Legacy aliases for backward compatibility
export type RestaurantStatus = CompanyStatus;
export type Restaurant = Company;
export type RestaurantListParams = CompanyListParams;
export type RestaurantListResponse = CompanyListResponse;
export type RestaurantStatsResponse = CompanyStatsResponse;
