export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "app": {
          Tables: {
            "rate_limits": {
                  Row: {
                    "bucket": string,"hits": number,"key_hash": string,"updated_at": string,"window_started_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": string,"hits"?: number,"key_hash": string,"updated_at"?: string,"window_started_at"?: string
                  }
                  Update: {
                    "bucket"?: string,"hits"?: number,"key_hash"?: string,"updated_at"?: string,"window_started_at"?: string
                  }
                  Relationships: [

                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "fn_company_admin_guard":
{ Args: { "p_actor_id": string,"p_user_id": string }; Returns: Record<string, unknown>
                           },
"fn_company_has_other_admin":
{ Args: { "p_company_id": string,"p_user_id": string }; Returns: boolean
                           },
"fn_effective_access":
{ Args: { "p_drawing_id": string }; Returns: string
                           },
"fn_is_active_user":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"fn_is_company_admin":
{ Args: { "p_company_id": string }; Returns: boolean
                           },
"fn_is_company_member":
{ Args: { "p_company_id": string }; Returns: boolean
                           },
"fn_is_platform_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"fn_owns_drawing":
{ Args: { "p_drawing_id": string }; Returns: boolean
                           },
"fn_owns_tool_asset_path":
{ Args: { "p_name": string }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activity_events": {
                  Row: {
                    "drawing_id": string | null,"id": string,"kind": string,"markup_count": number,"name": string,"occurred_at": string,"page_count": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "drawing_id"?: string | null,"id"?: string,"kind": string,"markup_count"?: number,"name": string,"occurred_at"?: string,"page_count": number,"user_id"?: string
                  }
                  Update: {
                    "drawing_id"?: string | null,"id"?: string,"kind"?: string,"markup_count"?: number,"name"?: string,"occurred_at"?: string,"page_count"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_events_drawing_id_fkey"
      columns: ["drawing_id"]
isOneToOne: false
      referencedRelation: "drawings"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string,"detail": NonNullable<Json>,"id": string,"occurred_at": string,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"detail"?: NonNullable<Json>,"id"?: string,"occurred_at"?: string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"detail"?: NonNullable<Json>,"id"?: string,"occurred_at"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [

                  ]
                },"calibrations": {
                  Row: {
                    "calibration": NonNullable<Json>,"page_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calibration": NonNullable<Json>,"page_id": string,"updated_at"?: string
                  }
                  Update: {
                    "calibration"?: NonNullable<Json>,"page_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calibrations_page_id_fkey"
      columns: ["page_id"]
isOneToOne: true
      referencedRelation: "pages"
      referencedColumns: ["id"]
    }
                  ]
                },"companies": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"plan": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"plan"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"plan"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"company_invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"company_id": string,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string,"revoked_at": string | null,"role": string,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"company_id": string,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"invited_by": string,"revoked_at"?: string | null,"role": string,"token_hash": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"company_id"?: string,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string,"revoked_at"?: string | null,"role"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_company_invitations_company"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"company_members": {
                  Row: {
                    "company_id": string,"created_at": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id": string,"created_at"?: string,"role": string,"user_id": string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_company_members_company"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_company_members_profile"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"drawing_files": {
                  Row: {
                    "created_at": string,"drawing_id": string,"filename": string,"fingerprint": string | null,"id": string,"page_count": number,"parent_file_id": string | null,"sha256": string,"storage_path": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"drawing_id": string,"filename": string,"fingerprint"?: string | null,"id"?: string,"page_count": number,"parent_file_id"?: string | null,"sha256": string,"storage_path"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"drawing_id"?: string,"filename"?: string,"fingerprint"?: string | null,"id"?: string,"page_count"?: number,"parent_file_id"?: string | null,"sha256"?: string,"storage_path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "drawing_files_drawing_id_fkey"
      columns: ["drawing_id"]
isOneToOne: false
      referencedRelation: "drawings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "drawing_files_parent_file_id_fkey"
      columns: ["parent_file_id"]
isOneToOne: false
      referencedRelation: "drawing_files"
      referencedColumns: ["id"]
    }
                  ]
                },"drawings": {
                  Row: {
                    "created_at": string,"id": string,"owner_id": string,"storage_enabled": boolean,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"owner_id"?: string,"storage_enabled"?: boolean,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"owner_id"?: string,"storage_enabled"?: boolean,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"markups": {
                  Row: {
                    "author_id": string,"created_at": string,"deleted_at": string | null,"drawing_id": string,"field_versions": NonNullable<Json>,"geometry": NonNullable<Json>,"id": string,"last_op_id": string | null,"page_id": string,"props": NonNullable<Json>,"style": NonNullable<Json>,"type": string,"updated_at": string,"updated_by": string | null,"version": number,"z": number
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"created_at"?: string,"deleted_at"?: string | null,"drawing_id": string,"field_versions"?: NonNullable<Json>,"geometry": NonNullable<Json>,"id": string,"last_op_id"?: string | null,"page_id": string,"props"?: NonNullable<Json>,"style": NonNullable<Json>,"type": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"z"?: number
                  }
                  Update: {
                    "author_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"drawing_id"?: string,"field_versions"?: NonNullable<Json>,"geometry"?: NonNullable<Json>,"id"?: string,"last_op_id"?: string | null,"page_id"?: string,"props"?: NonNullable<Json>,"style"?: NonNullable<Json>,"type"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"z"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "markups_drawing_id_fkey"
      columns: ["drawing_id"]
isOneToOne: false
      referencedRelation: "drawings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "markups_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "pages"
      referencedColumns: ["id"]
    }
                  ]
                },"pages": {
                  Row: {
                    "crop_box": (number)[],"drawing_file_id": string,"height": number,"id": string,"index": number,"rotation": number,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "crop_box": (number)[],"drawing_file_id": string,"height": number,"id"?: string,"index": number,"rotation"?: number,"width": number
                  }
                  Update: {
                    "crop_box"?: (number)[],"drawing_file_id"?: string,"height"?: number,"id"?: string,"index"?: number,"rotation"?: number,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "pages_drawing_file_id_fkey"
      columns: ["drawing_file_id"]
isOneToOne: false
      referencedRelation: "drawing_files"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"is_platform_admin": boolean,"name": string,"plan": string,"status": string,"theme": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id": string,"is_platform_admin"?: boolean,"name"?: string,"plan"?: string,"status"?: string,"theme"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"is_platform_admin"?: boolean,"name"?: string,"plan"?: string,"status"?: string,"theme"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"rule_figures": {
                  Row: {
                    "created_at": string,"hazards": NonNullable<Json>,"ruleset_id": string,"source": string,"tables": NonNullable<Json>,"verified": boolean,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"hazards": NonNullable<Json>,"ruleset_id": string,"source": string,"tables"?: NonNullable<Json>,"verified": boolean,"version": string
                  }
                  Update: {
                    "created_at"?: string,"hazards"?: NonNullable<Json>,"ruleset_id"?: string,"source"?: string,"tables"?: NonNullable<Json>,"verified"?: boolean,"version"?: string
                  }
                  Relationships: [

                  ]
                },"signatures": {
                  Row: {
                    "height": number,"storage_path": string,"updated_at": string,"user_id": string,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "height": number,"storage_path": string,"updated_at"?: string,"user_id": string,"width": number
                  }
                  Update: {
                    "height"?: number,"storage_path"?: string,"updated_at"?: string,"user_id"?: string,"width"?: number
                  }
                  Relationships: [

                  ]
                },"tool_sets": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string,"position": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"owner_id"?: string,"position"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string,"position"?: number,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"tools": {
                  Row: {
                    "asset_path": string | null,"created_at": string,"device": Json | null,"id": string,"markup": NonNullable<Json>,"name": string,"owner_id": string,"position": number,"tool_set_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_path"?: string | null,"created_at"?: string,"device"?: Json | null,"id"?: string,"markup": NonNullable<Json>,"name": string,"owner_id"?: string,"position"?: number,"tool_set_id": string,"updated_at"?: string
                  }
                  Update: {
                    "asset_path"?: string | null,"created_at"?: string,"device"?: Json | null,"id"?: string,"markup"?: NonNullable<Json>,"name"?: string,"owner_id"?: string,"position"?: number,"tool_set_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tools_tool_set_id_fkey"
      columns: ["tool_set_id"]
isOneToOne: false
      referencedRelation: "tool_sets"
      referencedColumns: ["id"]
    }
                  ]
                },"use_hazard_map": {
                  Row: {
                    "company_id": string | null,"created_at": string,"hazard": string,"id": string,"is_default": boolean,"map_version": string,"updated_at": string,"use": string,"verified": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id"?: string | null,"created_at"?: string,"hazard": string,"id"?: string,"is_default"?: boolean,"map_version": string,"updated_at"?: string,"use": string,"verified"?: boolean
                  }
                  Update: {
                    "company_id"?: string | null,"created_at"?: string,"hazard"?: string,"id"?: string,"is_default"?: boolean,"map_version"?: string,"updated_at"?: string,"use"?: string,"verified"?: boolean
                  }
                  Relationships: [

                  ]
                },"zone_layouts": {
                  Row: {
                    "created_at": string,"created_by": string,"drawing_id": string,"head_count": number,"id": string,"inputs": NonNullable<Json>,"report": Json | null,"result": NonNullable<Json>,"rule_figure_version": string,"ruleset_id": string,"status": string,"zone_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"drawing_id": string,"head_count"?: number,"id"?: string,"inputs": NonNullable<Json>,"report"?: Json | null,"result": NonNullable<Json>,"rule_figure_version": string,"ruleset_id": string,"status": string,"zone_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"drawing_id"?: string,"head_count"?: number,"id"?: string,"inputs"?: NonNullable<Json>,"report"?: Json | null,"result"?: NonNullable<Json>,"rule_figure_version"?: string,"ruleset_id"?: string,"status"?: string,"zone_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "zone_layouts_drawing_id_fkey"
      columns: ["drawing_id"]
isOneToOne: false
      referencedRelation: "drawings"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "zones": {
                  Row: {
                    "created_at": string | null,"drawing_id": string | null,"hole_tags": Json | null,"holes": Json | null,"id": string | null,"name": string | null,"options": Json | null,"page_id": string | null,"polygon": Json | null,"updated_at": string | null,"use": string | null,"version": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "created_at"?: string | null,"drawing_id"?: string | null,"hole_tags"?: never,"holes"?: never,"id"?: string | null,"name"?: never,"options"?: never,"page_id"?: string | null,"polygon"?: never,"updated_at"?: string | null,"use"?: never,"version"?: number | null
                         }
                        Update: {
                           "created_at"?: string | null,"drawing_id"?: string | null,"hole_tags"?: never,"holes"?: never,"id"?: string | null,"name"?: never,"options"?: never,"page_id"?: string | null,"polygon"?: never,"updated_at"?: string | null,"use"?: never,"version"?: number | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "markups_drawing_id_fkey"
      columns: ["drawing_id"]
isOneToOne: false
      referencedRelation: "drawings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "markups_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "pages"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "accept_company_invitation":
{ Args: { "p_token_hash": string,"p_user_id": string }; Returns: {
              "company_id": string,"company_name": string,"role": string
            }[]
                           },
"activity_summary":
{ Args: { "p_scope": string }; Returns: {
              "active_days_by_week": (number)[],"company_id": string,"company_name": string,"drawings_by_week": (number)[],"email": string,"exports_by_week": (number)[],"exports_total": number,"last_active_at": string,"markups_by_week": (number)[],"markups_total": number,"name": string,"placements_by_week": (number)[],"prints_by_week": (number)[],"status": string,"user_id": string
            }[]
                           },
"admin_create_company":
{ Args: { "p_actor_id": string,"p_admin_email": string,"p_name": string }; Returns: {
              "admin_user_id": string,"company_id": string
            }[]
                           },
"admin_lookup_markup_sets":
{ Args: { "p_actor_id": string,"p_user_id": string }; Returns: {
              "created_at": string,"drawing_id": string,"file_count": number,"filename": string,"last_saved_at": string,"markup_count": number,"page_count": number
            }[]
                           },
"admin_set_plan":
{ Args: { "p_actor_id": string,"p_plan": string,"p_target_id": string,"p_target_type": string }; Returns: {
              "previous_plan": string
            }[]
                           },
"admin_set_user_status":
{ Args: { "p_actor_id": string,"p_status": string,"p_user_id": string }; Returns: {
              "email": string,"name": string,"previous_status": string
            }[]
                           },
"apply_markup_ops":
{ Args: { "p_drawing_id": string,"p_ops": Json }; Returns: Json
                           },
"consume_rate_limit":
{ Args: { "p_bucket": string,"p_key_hash": string,"p_max_hits": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"retry_after_seconds": number
            }[]
                           },
"create_company_invitation":
{ Args: { "p_actor_id": string,"p_email": string,"p_role": string,"p_token_hash": string }; Returns: {
              "company_id": string,"company_name": string,"expires_at": string,"invitation_id": string
            }[]
                           },
"ensure_drawing_file":
{ Args: { "p_filename": string,"p_pages": Json,"p_sha256": string }; Returns: {
              "drawing_id": string,"file_id": string,"page_ids": (string)[]
            }[]
                           },
"get_company_invitation":
{ Args: { "p_token_hash": string }; Returns: {
              "account_exists": boolean,"company_name": string,"email": string,"invitation_id": string,"role": string,"state": string
            }[]
                           },
"list_company_members":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"joined_at": string,"name": string,"role": string,"user_id": string
            }[]
                           },
"list_markup_sets":
{ Args: Record<PropertyKey, never>; Returns: {
              "drawing_id": string,"filename": string,"last_modified": string,"markup_count": number,"page_count": number,"sha256": string,"title": string
            }[]
                           },
"remove_company_member":
{ Args: { "p_actor_id": string,"p_user_id": string }; Returns: undefined
                           },
"revoke_company_invitation":
{ Args: { "p_actor_id": string,"p_invitation_id": string }; Returns: undefined
                           },
"set_company_member_role":
{ Args: { "p_actor_id": string,"p_role": string,"p_user_id": string }; Returns: {
              "previous_role": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "app": {
          Enums: {

          }
        },"public": {
          Enums: {

          }
        }
} as const
