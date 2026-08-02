/**
 * Journey Definition — admin CRUD shape matching Task 6
 * (src/routes/journeys.js createDefSchema / stored item).
 * Screens/fields builder is Task 3b — V1 list/CRUD keeps screens as [].
 */

export interface JourneyScreenField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  /** Optional ₹ unit price for type:'number'. 0 = free item; omit = no price UI. */
  unitPrice?: number;
}

export interface JourneyScreen {
  id: string;
  title: string;
  fields: JourneyScreenField[];
}

export interface JourneyBrandingConfig {
  primaryColor?: string;
  /** Absolute https URL shown as the public journey banner. Optional. */
  bannerImageUrl?: string;
}

export type JourneyGstMode = 'exclusive' | 'inclusive';

export interface JourneyDefinition {
  id: string;
  companyId: string;
  name: string;
  industryPack: string;
  screens: JourneyScreen[];
  brandingConfig: JourneyBrandingConfig | Record<string, unknown> | null;
  linkedWorkflowId: string | null;
  active: boolean;
  /** Definition-level GST (display-only on review until payment ships). */
  gstEnabled?: boolean;
  gstPercent?: number;
  gstMode?: JourneyGstMode;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  version?: number;
}

export interface JourneyDefinitionFormValues {
  name: string;
  industryPack: string;
  linkedWorkflowId: string | null;
  active: boolean;
  /** Ordered screens — Task 3b; create/update both persist this array. */
  screens: JourneyScreen[];
  /** Branding — { primaryColor?, bannerImageUrl? }. null = none. */
  brandingConfig: JourneyBrandingConfig | null;
  gstEnabled: boolean;
  gstPercent: number;
  gstMode: JourneyGstMode;
}

export interface ListJourneyDefinitionsResponse {
  success: boolean;
  definitions: JourneyDefinition[];
}

export interface CreateJourneyDefinitionResponse {
  success: boolean;
  definition: JourneyDefinition;
}

export interface MutateJourneyDefinitionResponse {
  success: boolean;
}
