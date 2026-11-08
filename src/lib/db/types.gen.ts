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
            "fn_effective_access":
{ Args: { "p_drawing_id": string }; Returns: string
                           },
"fn_is_active_user":
{ Args: Record<PropertyKey, never>; Returns: boolean
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
                    "created_at": string,"email": string,"id": string,"is_platform_admin": boolean,"name": string,"status": string,"theme": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id": string,"is_platform_admin"?: boolean,"name"?: string,"status"?: string,"theme"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"is_platform_admin"?: boolean,"name"?: string,"status"?: string,"theme"?: string,"updated_at"?: string
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "apply_markup_ops":
{ Args: { "p_drawing_id": string,"p_ops": Json }; Returns: Json
                           },
"consume_rate_limit":
{ Args: { "p_bucket": string,"p_key_hash": string,"p_max_hits": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"retry_after_seconds": number
            }[]
                           },
"ensure_drawing_file":
{ Args: { "p_filename": string,"p_pages": Json,"p_sha256": string }; Returns: {
              "drawing_id": string,"file_id": string,"page_ids": (string)[]
            }[]
                           },
"list_markup_sets":
{ Args: Record<PropertyKey, never>; Returns: {
              "drawing_id": string,"filename": string,"last_modified": string,"markup_count": number,"page_count": number,"sha256": string,"title": string
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
