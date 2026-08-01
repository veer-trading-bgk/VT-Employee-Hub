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
}

export interface JourneyScreen {
  id: string;
  title: string;
  fields: JourneyScreenField[];
}

export interface JourneyBrandingConfig {
  primaryColor: string;
}

export interface JourneyDefinition {
  id: string;
  companyId: string;
  name: string;
  industryPack: string;
  screens: JourneyScreen[];
  brandingConfig: JourneyBrandingConfig | Record<string, unknown> | null;
  linkedWorkflowId: string | null;
  active: boolean;
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
  /** Minimal branding — architecture shape { primaryColor }. null = none. */
  brandingConfig: JourneyBrandingConfig | null;
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
