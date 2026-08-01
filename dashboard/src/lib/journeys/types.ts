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

export interface JourneyDefinition {
  id: string;
  companyId: string;
  name: string;
  industryPack: string;
  screens: JourneyScreen[];
  brandingConfig: Record<string, unknown> | null;
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
