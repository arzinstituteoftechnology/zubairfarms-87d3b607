export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          metadata: Json
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_incidents: {
        Row: {
          details: Json
          fired_at: string
          id: string
          metric: string
          observed_value: number
          resolved_at: string | null
          rule_id: string
          severity: Database["public"]["Enums"]["system_error_severity"]
          snapshot_id: string | null
          status: string
          threshold: number
        }
        Insert: {
          details?: Json
          fired_at?: string
          id?: string
          metric: string
          observed_value: number
          resolved_at?: string | null
          rule_id: string
          severity: Database["public"]["Enums"]["system_error_severity"]
          snapshot_id?: string | null
          status?: string
          threshold: number
        }
        Update: {
          details?: Json
          fired_at?: string
          id?: string
          metric?: string
          observed_value?: number
          resolved_at?: string | null
          rule_id?: string
          severity?: Database["public"]["Enums"]["system_error_severity"]
          snapshot_id?: string | null
          status?: string
          threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "alert_incidents_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          metric: string
          name: string
          op: string
          severity: Database["public"]["Enums"]["system_error_severity"]
          threshold: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          metric: string
          name: string
          op: string
          severity?: Database["public"]["Enums"]["system_error_severity"]
          threshold: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          metric?: string
          name?: string
          op?: string
          severity?: Database["public"]["Enums"]["system_error_severity"]
          threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      background_jobs: {
        Row: {
          attempts: number
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error_details: Json | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          next_run_at: string
          payload: Json
          priority: number
          progress: number
          progress_message: string | null
          result: Json | null
          retention_expires_at: string | null
          scheduled_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string | null
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error_details?: Json | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          next_run_at?: string
          payload?: Json
          priority?: number
          progress?: number
          progress_message?: string | null
          result?: Json | null
          retention_expires_at?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string | null
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error_details?: Json | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          next_run_at?: string
          payload?: Json
          priority?: number
          progress?: number
          progress_message?: string | null
          result?: Json | null
          retention_expires_at?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string | null
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      background_jobs_dead_letter: {
        Row: {
          attempts: number
          created_at: string
          error_details: Json | null
          id: string
          job_type: string
          last_error: string | null
          moved_at: string
          original_job_id: string
          payload: Json
          tenant_id: string | null
        }
        Insert: {
          attempts: number
          created_at?: string
          error_details?: Json | null
          id?: string
          job_type: string
          last_error?: string | null
          moved_at?: string
          original_job_id: string
          payload?: Json
          tenant_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error_details?: Json | null
          id?: string
          job_type?: string
          last_error?: string | null
          moved_at?: string
          original_job_id?: string
          payload?: Json
          tenant_id?: string | null
        }
        Relationships: []
      }
      backup_history: {
        Row: {
          backup_name: string | null
          backup_type: string
          checksum_sha256: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          drive_status: string | null
          email_status: string | null
          error_message: string | null
          file_size: number | null
          health: Json | null
          id: string
          schema_version: string | null
          status: string
          storage_path: string | null
          table_counts: Json | null
          tenant_id: string | null
          tenant_name: string | null
        }
        Insert: {
          backup_name?: string | null
          backup_type: string
          checksum_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          drive_status?: string | null
          email_status?: string | null
          error_message?: string | null
          file_size?: number | null
          health?: Json | null
          id?: string
          schema_version?: string | null
          status?: string
          storage_path?: string | null
          table_counts?: Json | null
          tenant_id?: string | null
          tenant_name?: string | null
        }
        Update: {
          backup_name?: string | null
          backup_type?: string
          checksum_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          drive_status?: string | null
          email_status?: string | null
          error_message?: string | null
          file_size?: number | null
          health?: Json | null
          id?: string
          schema_version?: string | null
          status?: string
          storage_path?: string | null
          table_counts?: Json | null
          tenant_id?: string | null
          tenant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backup_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_settings: {
        Row: {
          drive_enabled: boolean
          drive_folder_id: string | null
          drive_last_status: string | null
          drive_last_upload_at: string | null
          email_enabled: boolean
          id: number
          primary_email: string | null
          retain_daily: number
          retain_manual: number
          retain_monthly: number
          schedule_cron: string
          secondary_email: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          drive_enabled?: boolean
          drive_folder_id?: string | null
          drive_last_status?: string | null
          drive_last_upload_at?: string | null
          email_enabled?: boolean
          id?: number
          primary_email?: string | null
          retain_daily?: number
          retain_manual?: number
          retain_monthly?: number
          schedule_cron?: string
          secondary_email?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          drive_enabled?: boolean
          drive_folder_id?: string | null
          drive_last_status?: string | null
          drive_last_upload_at?: string | null
          email_enabled?: boolean
          id?: number
          primary_email?: string | null
          retain_daily?: number
          retain_manual?: number
          retain_monthly?: number
          schedule_cron?: string
          secondary_email?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      business_profiles: {
        Row: {
          address: string | null
          company_name: string | null
          created_at: string
          currency: string
          email: string | null
          id: string
          logo_url: string | null
          ntn: string | null
          phone: string | null
          strn: string | null
          tenant_id: string
          time_zone: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          company_name?: string | null
          created_at?: string
          currency?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          ntn?: string | null
          phone?: string | null
          strn?: string | null
          tenant_id: string
          time_zone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          company_name?: string | null
          created_at?: string
          currency?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          ntn?: string | null
          phone?: string | null
          strn?: string | null
          tenant_id?: string
          time_zone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      customer_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          method: string
          notes: string | null
          payment_date: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          method?: string
          notes?: string | null
          payment_date?: string
          tenant_id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          method?: string
          notes?: string | null
          payment_date?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          credit_limit: number
          id: string
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          chickens_count: number
          created_at: string
          created_by: string | null
          destination: string | null
          farm_id: string | null
          fuel_expense: number
          id: string
          labour_expense: number
          loading_date: string
          loading_time: string | null
          notes: string | null
          other_expense: number
          tenant_id: string
          total_weight_kg: number
          truck_id: string | null
          updated_at: string
        }
        Insert: {
          chickens_count?: number
          created_at?: string
          created_by?: string | null
          destination?: string | null
          farm_id?: string | null
          fuel_expense?: number
          id?: string
          labour_expense?: number
          loading_date?: string
          loading_time?: string | null
          notes?: string | null
          other_expense?: number
          tenant_id?: string
          total_weight_kg?: number
          truck_id?: string | null
          updated_at?: string
        }
        Update: {
          chickens_count?: number
          created_at?: string
          created_by?: string | null
          destination?: string | null
          farm_id?: string | null
          fuel_expense?: number
          id?: string
          labour_expense?: number
          loading_date?: string
          loading_time?: string | null
          notes?: string | null
          other_expense?: number
          tenant_id?: string
          total_weight_kg?: number
          truck_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      email_notification_queue: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          notification_id: string | null
          recipient_email: string
          recipient_user_id: string
          sent_at: string | null
          status: string
          template: string
          template_data: Json
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          notification_id?: string | null
          recipient_email: string
          recipient_user_id: string
          sent_at?: string | null
          status?: string
          template?: string
          template_data?: Json
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          notification_id?: string | null
          recipient_email?: string
          recipient_user_id?: string
          sent_at?: string | null
          status?: string
          template?: string
          template_data?: Json
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_notification_queue_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          expense_date: string
          farm_id: string | null
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          expense_date?: string
          farm_id?: string | null
          id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          expense_date?: string
          farm_id?: string | null
          id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      farm_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          farm_id: string
          id: string
          method: string
          notes: string | null
          payment_date: string
          reversal_ledger_entry_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          farm_id: string
          id?: string
          method?: string
          notes?: string | null
          payment_date?: string
          reversal_ledger_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          tenant_id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          farm_id?: string
          id?: string
          method?: string
          notes?: string | null
          payment_date?: string
          reversal_ledger_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "farm_payments_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "farm_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      farms: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          opening_balance: number
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "farms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_mode: {
        Row: {
          enabled: boolean
          estimated_return_at: string | null
          message: string | null
          read_only: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          estimated_return_at?: string | null
          message?: string | null
          read_only?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          estimated_return_at?: string | null
          message?: string | null
          read_only?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      meat_types: {
        Row: {
          color: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email: boolean
          id: string
          in_app: boolean
          min_priority: Database["public"]["Enums"]["notification_priority"]
          module: string
          muted_until: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: boolean
          id?: string
          in_app?: boolean
          min_priority?: Database["public"]["Enums"]["notification_priority"]
          module?: string
          muted_until?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: boolean
          id?: string
          in_app?: boolean
          min_priority?: Database["public"]["Enums"]["notification_priority"]
          module?: string
          muted_until?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          dedupe_key: string | null
          deleted_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean
          message: string
          metadata: Json
          module: string
          priority: Database["public"]["Enums"]["notification_priority"]
          read_at: string | null
          tenant_id: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          message: string
          metadata?: Json
          module: string
          priority?: Database["public"]["Enums"]["notification_priority"]
          read_at?: string | null
          tenant_id?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          message?: string
          metadata?: Json
          module?: string
          priority?: Database["public"]["Enums"]["notification_priority"]
          read_at?: string | null
          tenant_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          code: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          expiry_date: string | null
          id: string
          invoice_number: string
          notes: string | null
          payment_date: string
          plan_name: string
          status: string
          subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          expiry_date?: string | null
          id?: string
          invoice_number: string
          notes?: string | null
          payment_date?: string
          plan_name: string
          status?: string
          subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          expiry_date?: string | null
          id?: string
          invoice_number?: string
          notes?: string | null
          payment_date?: string
          plan_name?: string
          status?: string
          subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_ip: string | null
          actor_user_agent: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          module: string | null
          new_value: Json | null
          permission_action: string | null
          previous_value: Json | null
          reason: string | null
          target_email: string | null
          target_user_id: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_ip?: string | null
          actor_user_agent?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          module?: string | null
          new_value?: Json | null
          permission_action?: string | null
          previous_value?: Json | null
          reason?: string | null
          target_email?: string | null
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_ip?: string | null
          actor_user_agent?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          module?: string | null
          new_value?: Json | null
          permission_action?: string | null
          previous_value?: Json | null
          reason?: string | null
          target_email?: string | null
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sale_items: {
        Row: {
          created_at: string
          faraq: number
          final_rate: number
          id: string
          line_total: number
          meat_type: string
          rate_per_kg: number
          sale_id: string
          tenant_id: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          faraq?: number
          final_rate: number
          id?: string
          line_total: number
          meat_type: string
          rate_per_kg: number
          sale_id: string
          tenant_id?: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          faraq?: number
          final_rate?: number
          id?: string
          line_total?: number
          meat_type?: string
          rate_per_kg?: number
          sale_id?: string
          tenant_id?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sale_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sales: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount: number
          due: number
          id: string
          invoice_no: number
          notes: string | null
          paid: number
          payment_method: string
          sale_date: string
          sale_type: string
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          due?: number
          id?: string
          invoice_no?: number
          notes?: string | null
          paid?: number
          payment_method?: string
          sale_date?: string
          sale_type?: string
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          due?: number
          id?: string
          invoice_no?: number
          notes?: string | null
          paid?: number
          payment_method?: string
          sale_date?: string
          sale_type?: string
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          must_change_password: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          must_change_password?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          must_change_password?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          created_at: string
          created_by: string | null
          faraq: number
          farm_id: string
          id: string
          meat_type: string
          notes: string | null
          paid_amount: number
          payment_method: string
          purchase_date: string
          rate_per_kg: number
          reversal_ledger_entry_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          tenant_id: string
          total_amount: number | null
          updated_at: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          faraq?: number
          farm_id: string
          id?: string
          meat_type: string
          notes?: string | null
          paid_amount?: number
          payment_method?: string
          purchase_date?: string
          rate_per_kg: number
          reversal_ledger_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          tenant_id?: string
          total_amount?: number | null
          updated_at?: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          faraq?: number
          farm_id?: string
          id?: string
          meat_type?: string
          notes?: string | null
          paid_amount?: number
          payment_method?: string
          purchase_date?: string
          rate_per_kg?: number
          reversal_ledger_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          tenant_id?: string
          total_amount?: number | null
          updated_at?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          action: string
          allowed: boolean
          module: string
          role: string
          updated_at: string
        }
        Insert: {
          action: string
          allowed?: boolean
          module: string
          role: string
          updated_at?: string
        }
        Update: {
          action?: string
          allowed?: boolean
          module?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_template_permissions: {
        Row: {
          action: string
          allowed: boolean
          id: string
          module: string
          template_id: string
          updated_at: string
        }
        Insert: {
          action: string
          allowed?: boolean
          id?: string
          module: string
          template_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          allowed?: boolean
          id?: string
          module?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_template_permissions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "role_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      role_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          snapshot: Json
          template_id: string
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          snapshot: Json
          template_id: string
          version_no: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          snapshot?: Json
          template_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "role_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "role_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      role_templates: {
        Row: {
          builtin_key: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_builtin: boolean
          name: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          builtin_key?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_builtin?: boolean
          name: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          builtin_key?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_builtin?: boolean
          name?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          id: number
          row_id: string
          tenant_id: string
          updated_at: string
          wastage_threshold_pct: number
        }
        Insert: {
          id?: number
          row_id?: string
          tenant_id?: string
          updated_at?: string
          wastage_threshold_pct?: number
        }
        Update: {
          id?: number
          row_id?: string
          tenant_id?: string
          updated_at?: string
          wastage_threshold_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_ledger_entries: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          edited_at: string | null
          edited_by: string | null
          entry_date: string
          entry_type: Database["public"]["Enums"]["shop_ledger_type"]
          id: string
          original_entry_id: string | null
          reversal_entry_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          shop_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          edited_at?: string | null
          edited_by?: string | null
          entry_date?: string
          entry_type: Database["public"]["Enums"]["shop_ledger_type"]
          id?: string
          original_entry_id?: string | null
          reversal_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shop_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          edited_at?: string | null
          edited_by?: string | null
          entry_date?: string
          entry_type?: Database["public"]["Enums"]["shop_ledger_type"]
          id?: string
          original_entry_id?: string | null
          reversal_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shop_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_ledger_entries_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_recoveries: {
        Row: {
          amount: number
          collected_by: string | null
          created_at: string
          created_by: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          ledger_entry_id: string | null
          notes: string | null
          payment_method: string
          recovery_date: string
          reversal_ledger_entry_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          shop_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          collected_by?: string | null
          created_at?: string
          created_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          ledger_entry_id?: string | null
          notes?: string | null
          payment_method?: string
          recovery_date?: string
          reversal_ledger_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shop_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          collected_by?: string | null
          created_at?: string
          created_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          ledger_entry_id?: string | null
          notes?: string | null
          payment_method?: string
          recovery_date?: string
          reversal_ledger_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shop_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_recoveries_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          opening_balance: number
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shops_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_delivery_logs: {
        Row: {
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          event_type: string
          id: string
          phone_number_masked: string
          provider_message_id: string | null
          provider_response: Json
          sent_at: string | null
          sms_queue_id: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          phone_number_masked: string
          provider_message_id?: string | null
          provider_response?: Json
          sent_at?: string | null
          sms_queue_id?: string | null
          status: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          phone_number_masked?: string
          provider_message_id?: string | null
          provider_response?: Json
          sent_at?: string | null
          sms_queue_id?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_delivery_logs_sms_queue_id_fkey"
            columns: ["sms_queue_id"]
            isOneToOne: false
            referencedRelation: "sms_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_delivery_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_queue: {
        Row: {
          attempt_count: number
          created_at: string
          error_message: string | null
          event_type: string
          failed_at: string | null
          id: string
          idempotency_key: string
          max_attempts: number
          message_body: string
          phone_number: string
          provider: string
          provider_message_id: string | null
          provider_status: string | null
          recipient_name: string | null
          recipient_type: string
          related_record_id: string | null
          related_table: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          event_type: string
          failed_at?: string | null
          id?: string
          idempotency_key: string
          max_attempts?: number
          message_body: string
          phone_number: string
          provider?: string
          provider_message_id?: string | null
          provider_status?: string | null
          recipient_name?: string | null
          recipient_type: string
          related_record_id?: string | null
          related_table?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          event_type?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          max_attempts?: number
          message_body?: string
          phone_number?: string
          provider?: string
          provider_message_id?: string | null
          provider_status?: string | null
          recipient_name?: string | null
          recipient_type?: string
          related_record_id?: string | null
          related_table?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_settings: {
        Row: {
          admin_notification_types: Json
          admin_phone: string | null
          country_code: string
          created_at: string
          customer_notification_types: Json
          id: string
          is_enabled: boolean
          notify_admin: boolean
          notify_customer: boolean
          provider: string
          quiet_hours_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          sender_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          admin_notification_types?: Json
          admin_phone?: string | null
          country_code?: string
          created_at?: string
          customer_notification_types?: Json
          id?: string
          is_enabled?: boolean
          notify_admin?: boolean
          notify_customer?: boolean
          provider?: string
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sender_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          admin_notification_types?: Json
          admin_phone?: string | null
          country_code?: string
          created_at?: string
          customer_notification_types?: Json
          id?: string
          is_enabled?: boolean
          notify_admin?: boolean
          notify_customer?: boolean
          provider?: string
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sender_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_templates: {
        Row: {
          created_at: string
          event_type: string
          id: string
          is_active: boolean
          language: string
          message_body: string
          recipient_type: string
          template_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          is_active?: boolean
          language?: string
          message_body: string
          recipient_type: string
          template_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          is_active?: boolean
          language?: string
          message_body?: string
          recipient_type?: string
          template_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustment_reasons: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_adjustments: {
        Row: {
          adjustment_date: string
          bird_count: number | null
          closing_id: string | null
          created_at: string
          created_by: string | null
          farm_id: string | null
          id: string
          meat_type: string
          notes: string | null
          original_adjustment_id: string | null
          quantity_kg: number
          reason: string | null
          reason_id: string | null
          reversal_adjustment_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          shop_id: string | null
          tenant_id: string
        }
        Insert: {
          adjustment_date: string
          bird_count?: number | null
          closing_id?: string | null
          created_at?: string
          created_by?: string | null
          farm_id?: string | null
          id?: string
          meat_type: string
          notes?: string | null
          original_adjustment_id?: string | null
          quantity_kg: number
          reason?: string | null
          reason_id?: string | null
          reversal_adjustment_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shop_id?: string | null
          tenant_id: string
        }
        Update: {
          adjustment_date?: string
          bird_count?: number | null
          closing_id?: string | null
          created_at?: string
          created_by?: string | null
          farm_id?: string | null
          id?: string
          meat_type?: string
          notes?: string | null
          original_adjustment_id?: string | null
          quantity_kg?: number
          reason?: string | null
          reason_id?: string | null
          reversal_adjustment_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shop_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "stock_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_original_adjustment_id_fkey"
            columns: ["original_adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustment_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_reversal_adjustment_id_fkey"
            columns: ["reversal_adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_closings: {
        Row: {
          adjustments_kg: number
          closing_date: string
          created_at: string
          created_by: string | null
          difference: number
          expected_closing_stock: number | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          meat_type: string
          mortality_weight: number
          negative_adjustments_kg: number
          notes: string | null
          opening_stock: number
          physical_stock: number
          positive_adjustments_kg: number
          purchases_kg: number
          reason: string | null
          reason_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          shortage_cost: number
          status: Database["public"]["Enums"]["stock_closing_status"]
          supplies_kg: number
          system_stock: number
          tenant_id: string
          updated_at: string
          variance_type:
            | Database["public"]["Enums"]["stock_variance_type"]
            | null
          variance_weight: number | null
        }
        Insert: {
          adjustments_kg?: number
          closing_date: string
          created_at?: string
          created_by?: string | null
          difference?: number
          expected_closing_stock?: number | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          meat_type: string
          mortality_weight?: number
          negative_adjustments_kg?: number
          notes?: string | null
          opening_stock?: number
          physical_stock?: number
          positive_adjustments_kg?: number
          purchases_kg?: number
          reason?: string | null
          reason_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shortage_cost?: number
          status?: Database["public"]["Enums"]["stock_closing_status"]
          supplies_kg?: number
          system_stock?: number
          tenant_id: string
          updated_at?: string
          variance_type?:
            | Database["public"]["Enums"]["stock_variance_type"]
            | null
          variance_weight?: number | null
        }
        Update: {
          adjustments_kg?: number
          closing_date?: string
          created_at?: string
          created_by?: string | null
          difference?: number
          expected_closing_stock?: number | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          meat_type?: string
          mortality_weight?: number
          negative_adjustments_kg?: number
          notes?: string | null
          opening_stock?: number
          physical_stock?: number
          positive_adjustments_kg?: number
          purchases_kg?: number
          reason?: string | null
          reason_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shortage_cost?: number
          status?: Database["public"]["Enums"]["stock_closing_status"]
          supplies_kg?: number
          system_stock?: number
          tenant_id?: string
          updated_at?: string
          variance_type?:
            | Database["public"]["Enums"]["stock_variance_type"]
            | null
          variance_weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_closings_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustment_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          from_plan_id: string | null
          id: string
          metadata: Json
          subscription_id: string | null
          tenant_id: string
          to_plan_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          from_plan_id?: string | null
          id?: string
          metadata?: Json
          subscription_id?: string | null
          tenant_id: string
          to_plan_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          from_plan_id?: string | null
          id?: string
          metadata?: Json
          subscription_id?: string | null
          tenant_id?: string
          to_plan_id?: string | null
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          api_access: boolean
          audit_access: boolean
          backup_frequency: string | null
          billing_cycle: string
          created_at: string
          duration_days: number
          features: Json
          id: string
          is_active: boolean
          max_farms: number | null
          max_shops: number | null
          max_storage_mb: number | null
          max_trucks: number | null
          max_users: number | null
          name: string
          price: number
          report_access: boolean
          support_priority: string
          tier: string | null
          updated_at: string
        }
        Insert: {
          api_access?: boolean
          audit_access?: boolean
          backup_frequency?: string | null
          billing_cycle: string
          created_at?: string
          duration_days: number
          features?: Json
          id?: string
          is_active?: boolean
          max_farms?: number | null
          max_shops?: number | null
          max_storage_mb?: number | null
          max_trucks?: number | null
          max_users?: number | null
          name: string
          price?: number
          report_access?: boolean
          support_priority?: string
          tier?: string | null
          updated_at?: string
        }
        Update: {
          api_access?: boolean
          audit_access?: boolean
          backup_frequency?: string | null
          billing_cycle?: string
          created_at?: string
          duration_days?: number
          features?: Json
          id?: string
          is_active?: boolean
          max_farms?: number | null
          max_shops?: number | null
          max_storage_mb?: number | null
          max_trucks?: number | null
          max_users?: number | null
          name?: string
          price?: number
          report_access?: boolean
          support_priority?: string
          tier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          activated_at: string | null
          cancelled_at: string | null
          created_at: string
          expires_at: string
          grace_period_days: number
          id: string
          is_trial: boolean
          issue_date: string
          license_key: string | null
          plan_id: string | null
          started_at: string
          status: string
          tenant_id: string
          trial_days: number | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          expires_at: string
          grace_period_days?: number
          id?: string
          is_trial?: boolean
          issue_date?: string
          license_key?: string | null
          plan_id?: string | null
          started_at?: string
          status?: string
          tenant_id: string
          trial_days?: number | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          expires_at?: string
          grace_period_days?: number
          id?: string
          is_trial?: boolean
          issue_date?: string
          license_key?: string | null
          plan_id?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
          trial_days?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admin_login_attempts: {
        Row: {
          created_at: string
          email: string
          id: string
          ip: string | null
          success: boolean
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      supplier_ledger_entries: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          entry_date: string
          entry_type: Database["public"]["Enums"]["supplier_ledger_type"]
          id: string
          original_entry_id: string | null
          reversal_entry_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          supplier_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_type: Database["public"]["Enums"]["supplier_ledger_type"]
          id?: string
          original_entry_id?: string | null
          reversal_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          supplier_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_type?: Database["public"]["Enums"]["supplier_ledger_type"]
          id?: string
          original_entry_id?: string | null
          reversal_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          supplier_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_ledger_entries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      supplies: {
        Row: {
          cost_per_kg: number
          created_at: string
          created_by: string | null
          id: string
          meat_type: string
          notes: string | null
          purchase_id: string | null
          rate_per_kg: number
          reversal_ledger_entry_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          shop_id: string
          supply_date: string
          tenant_id: string
          total_amount: number | null
          updated_at: string
          weight_kg: number
        }
        Insert: {
          cost_per_kg?: number
          created_at?: string
          created_by?: string | null
          id?: string
          meat_type: string
          notes?: string | null
          purchase_id?: string | null
          rate_per_kg: number
          reversal_ledger_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shop_id: string
          supply_date?: string
          tenant_id?: string
          total_amount?: number | null
          updated_at?: string
          weight_kg: number
        }
        Update: {
          cost_per_kg?: number
          created_at?: string
          created_by?: string | null
          id?: string
          meat_type?: string
          notes?: string | null
          purchase_id?: string | null
          rate_per_kg?: number
          reversal_ledger_entry_id?: string | null
          reversal_notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          shop_id?: string
          supply_date?: string
          tenant_id?: string
          total_amount?: number | null
          updated_at?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplies_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplies_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      system_errors: {
        Row: {
          context: Json
          created_at: string
          id: string
          message: string
          module: string
          request_method: string | null
          request_path: string | null
          resolution_notes: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["system_error_severity"]
          source: string
          stack: string | null
          status_code: number | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          id?: string
          message: string
          module?: string
          request_method?: string | null
          request_path?: string | null
          resolution_notes?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["system_error_severity"]
          source?: string
          stack?: string | null
          status_code?: number | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          id?: string
          message?: string
          module?: string
          request_method?: string | null
          request_path?: string | null
          resolution_notes?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["system_error_severity"]
          source?: string
          stack?: string | null
          status_code?: number | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      system_health_snapshots: {
        Row: {
          components: Json
          created_at: string
          id: string
          latency_ms: number | null
          metrics: Json
          overall: Database["public"]["Enums"]["health_status"]
          worker_id: string | null
        }
        Insert: {
          components?: Json
          created_at?: string
          id?: string
          latency_ms?: number | null
          metrics?: Json
          overall: Database["public"]["Enums"]["health_status"]
          worker_id?: string | null
        }
        Update: {
          components?: Json
          created_at?: string
          id?: string
          latency_ms?: number | null
          metrics?: Json
          overall?: Database["public"]["Enums"]["health_status"]
          worker_id?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          app_name: string
          currency: string
          customers_module_enabled: boolean
          default_trial_days: number
          id: number
          updated_at: string
        }
        Insert: {
          app_name?: string
          currency?: string
          customers_module_enabled?: boolean
          default_trial_days?: number
          id?: number
          updated_at?: string
        }
        Update: {
          app_name?: string
          currency?: string
          customers_module_enabled?: boolean
          default_trial_days?: number
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      tenant_backup_settings: {
        Row: {
          last_run_at: string | null
          next_run_at: string | null
          retain_backups: number
          schedule: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          last_run_at?: string | null
          next_run_at?: string | null
          retain_backups?: number
          schedule?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          last_run_at?: string | null
          next_run_at?: string | null
          retain_backups?: number
          schedule?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_backup_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_users: {
        Row: {
          created_at: string
          id: string
          role_template_id: string | null
          status: string
          tenant_id: string
          tenant_role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role_template_id?: string | null
          status?: string
          tenant_id: string
          tenant_role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role_template_id?: string | null
          status?: string
          tenant_id?: string
          tenant_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_users_role_template_id_fkey"
            columns: ["role_template_id"]
            isOneToOne: false
            referencedRelation: "role_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          city: string | null
          company_name: string
          country: string | null
          created_at: string
          deleted_at: string | null
          email: string
          farm_name: string | null
          id: string
          mobile: string | null
          owner_name: string
          status: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          company_name: string
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          farm_name?: string | null
          id?: string
          mobile?: string | null
          owner_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          company_name?: string
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          farm_name?: string | null
          id?: string
          mobile?: string | null
          owner_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      trucks: {
        Row: {
          created_at: string
          created_by: string | null
          driver_name: string | null
          driver_phone: string | null
          id: string
          notes: string | null
          number: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          id?: string
          notes?: string | null
          number: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          id?: string
          notes?: string | null
          number?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trucks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          code: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          cancelled_at: string | null
          created_at: string
          email: string
          expires_at: string
          force_password_change: boolean
          full_name: string | null
          id: string
          invited_by: string | null
          resend_count: number
          role_template_id: string | null
          sent_at: string
          status: string
          tenant_id: string
          tenant_role: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          force_password_change?: boolean
          full_name?: string | null
          id?: string
          invited_by?: string | null
          resend_count?: number
          role_template_id?: string | null
          sent_at?: string
          status?: string
          tenant_id: string
          tenant_role: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          force_password_change?: boolean
          full_name?: string | null
          id?: string
          invited_by?: string | null
          resend_count?: number
          role_template_id?: string | null
          sent_at?: string
          status?: string
          tenant_id?: string
          tenant_role?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invitations_role_template_id_fkey"
            columns: ["role_template_id"]
            isOneToOne: false
            referencedRelation: "role_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permission_overrides: {
        Row: {
          action: string
          allowed: boolean
          created_at: string
          module: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          allowed: boolean
          created_at?: string
          module: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          allowed?: boolean
          created_at?: string
          module?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _assert_can_reverse: { Args: never; Returns: undefined }
      _req_meta: { Args: never; Returns: Json }
      apply_bulk_permission_action: {
        Args: {
          _action: string
          _new_role?: string
          _reason?: string
          _source_user_id?: string
          _target_user_ids: string[]
        }
        Returns: Json
      }
      assert_can_reverse_module: {
        Args: { _module: string }
        Returns: undefined
      }
      assert_permission: {
        Args: { _action: string; _module: string }
        Returns: undefined
      }
      bootstrap_super_admin: { Args: never; Returns: boolean }
      cancel_job: { Args: { _id: string }; Returns: undefined }
      claim_next_jobs: {
        Args: { _limit?: number; _worker_id: string }
        Returns: {
          attempts: number
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error_details: Json | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          next_run_at: string
          payload: Json
          priority: number
          progress: number
          progress_message: string | null
          result: Json | null
          retention_expires_at: string | null
          scheduled_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string | null
          updated_at: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "background_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_background_jobs: { Args: never; Returns: number }
      complete_job: {
        Args: { _id: string; _result?: Json }
        Returns: undefined
      }
      compute_closing_war: {
        Args: { p_date: string; p_meat: string; p_tenant: string }
        Returns: number
      }
      current_tenant_id: { Args: never; Returns: string }
      delete_backup: {
        Args: { _id: string; _reason?: string }
        Returns: boolean
      }
      delete_job: { Args: { _id: string }; Returns: undefined }
      enqueue_job: {
        Args: {
          _delay_seconds?: number
          _idempotency_key?: string
          _job_type: string
          _max_attempts?: number
          _payload: Json
          _priority?: number
          _retention_hours?: number
          _tenant_id: string
        }
        Returns: string
      }
      ensure_sms_settings: {
        Args: { _tenant_id: string }
        Returns: {
          admin_notification_types: Json
          admin_phone: string | null
          country_code: string
          created_at: string
          customer_notification_types: Json
          id: string
          is_enabled: boolean
          notify_admin: boolean
          notify_customer: boolean
          provider: string
          quiet_hours_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          sender_id: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sms_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_job: {
        Args: { _details?: Json; _error: string; _id: string }
        Returns: undefined
      }
      finalize_stock_closing: {
        Args: { p_id: string }
        Returns: {
          adjustments_kg: number
          closing_date: string
          created_at: string
          created_by: string | null
          difference: number
          expected_closing_stock: number | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          meat_type: string
          mortality_weight: number
          negative_adjustments_kg: number
          notes: string | null
          opening_stock: number
          physical_stock: number
          positive_adjustments_kg: number
          purchases_kg: number
          reason: string | null
          reason_id: string | null
          reversal_notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          shortage_cost: number
          status: Database["public"]["Enums"]["stock_closing_status"]
          supplies_kg: number
          system_stock: number
          tenant_id: string
          updated_at: string
          variance_type:
            | Database["public"]["Enums"]["stock_variance_type"]
            | null
          variance_weight: number | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_closings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_license_key: { Args: never; Returns: string }
      get_live_metrics: { Args: { _window_minutes?: number }; Returns: Json }
      get_module_flags: {
        Args: never
        Returns: {
          customers_module_enabled: boolean
        }[]
      }
      has_permission: {
        Args: { _action: string; _module: string; _uid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_business_user: { Args: { _uid: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_manager_or_owner: {
        Args: { _tenant_id: string; _uid: string }
        Returns: boolean
      }
      is_tenant_owner: { Args: { _uid: string }; Returns: boolean }
      log_auth_event: {
        Args: { _event: string; _metadata?: Json; _success?: boolean }
        Returns: string
      }
      log_frontend_error: {
        Args: {
          _context?: Json
          _message: string
          _module: string
          _request_path?: string
          _severity?: string
          _stack?: string
        }
        Returns: string
      }
      log_subscription_event: {
        Args: {
          _event_type: string
          _from_plan_id?: string
          _metadata?: Json
          _subscription_id?: string
          _tenant_id: string
          _to_plan_id?: string
        }
        Returns: string
      }
      log_system_error: {
        Args: {
          _context?: Json
          _message: string
          _module: string
          _request_method?: string
          _request_path?: string
          _severity?: Database["public"]["Enums"]["system_error_severity"]
          _source?: string
          _stack?: string
          _status_code?: number
          _tenant_id?: string
        }
        Returns: string
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notification_read: { Args: { _id: string }; Returns: undefined }
      notify_admins_of_tenant: {
        Args: {
          _actor: string
          _dedupe: string
          _entity_id: string
          _entity_type: string
          _message: string
          _metadata: Json
          _module: string
          _priority: Database["public"]["Enums"]["notification_priority"]
          _tenant_id: string
          _title: string
          _type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: undefined
      }
      notify_expiring_subscriptions: { Args: never; Returns: number }
      notify_super_admins: {
        Args: {
          _actor: string
          _dedupe: string
          _entity_id: string
          _entity_type: string
          _message: string
          _metadata: Json
          _module: string
          _priority: Database["public"]["Enums"]["notification_priority"]
          _title: string
          _type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: undefined
      }
      record_super_admin_login_attempt: {
        Args: { _email: string; _success: boolean }
        Returns: undefined
      }
      recover_stuck_jobs: { Args: { _stale_minutes?: number }; Returns: number }
      report_job_progress: {
        Args: { _id: string; _message?: string; _pct: number }
        Returns: undefined
      }
      resolve_system_error: {
        Args: { _id: string; _notes?: string }
        Returns: undefined
      }
      retry_job: { Args: { _id: string }; Returns: undefined }
      reverse_farm_payment: {
        Args: { p_id: string; p_notes?: string; p_reason: string }
        Returns: string
      }
      reverse_purchase: {
        Args: { p_id: string; p_notes?: string; p_reason: string }
        Returns: string
      }
      reverse_shop_ledger_entry: {
        Args: { p_id: string; p_notes?: string; p_reason: string }
        Returns: string
      }
      reverse_shop_recovery: {
        Args: { p_id: string; p_notes?: string; p_reason: string }
        Returns: string
      }
      reverse_stock_adjustment: {
        Args: { p_id: string; p_notes?: string; p_reason: string }
        Returns: string
      }
      reverse_stock_closing: {
        Args: { p_id: string; p_notes?: string; p_reason: string }
        Returns: string
      }
      reverse_supplier_ledger_entry: {
        Args: { p_id: string; p_notes?: string; p_reason: string }
        Returns: string
      }
      reverse_supply: {
        Args: { p_id: string; p_notes?: string; p_reason: string }
        Returns: string
      }
      run_job_now: { Args: { _id: string }; Returns: undefined }
      seed_sms_default_templates: {
        Args: { _tenant_id: string }
        Returns: undefined
      }
      seed_tenant_settings: { Args: { _tid: string }; Returns: undefined }
      soft_delete_notification: { Args: { _id: string }; Returns: undefined }
      subscription_state: { Args: { _tenant_id: string }; Returns: Json }
      super_admin_exists: { Args: never; Returns: boolean }
      super_admin_login_lockout: { Args: { _email: string }; Returns: number }
      tenant_has_active_subscription: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      tenant_health_snapshot: { Args: { _tenant_id: string }; Returns: Json }
      tenant_usage: { Args: { _tenant_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "staff" | "super_admin" | "manager"
      health_status: "green" | "yellow" | "red"
      job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "dead"
      notification_priority: "low" | "normal" | "high" | "critical"
      notification_type:
        | "purchase_created"
        | "purchase_reversed"
        | "supply_created"
        | "supply_reversed"
        | "recovery_created"
        | "recovery_reversed"
        | "expense_created"
        | "farm_payment_created"
        | "farm_payment_reversed"
        | "customer_payment_created"
        | "stock_closing_created"
        | "stock_adjustment_created"
        | "stock_adjustment_reversed"
        | "ledger_entry_created"
        | "ledger_entry_reversed"
        | "daily_closing_finalized"
        | "factory_reset"
        | "business_reset"
        | "backup_created"
        | "backup_restored"
        | "backup_failed"
        | "user_created"
        | "user_updated"
        | "user_removed"
        | "permission_changed"
        | "role_permission_changed"
        | "password_changed"
        | "login_alert"
        | "super_admin_login"
        | "system"
        | "subscription_expiring"
        | "subscription_expired"
      shop_ledger_type:
        | "opening_balance"
        | "manual_supply"
        | "manual_payment"
        | "adjustment_increase"
        | "adjustment_decrease"
        | "recovery"
        | "reversed_recovery"
        | "reversed_supply"
        | "reversed_manual_supply"
        | "reversed_manual_payment"
        | "reversed_adjustment_increase"
        | "reversed_adjustment_decrease"
        | "reversed_opening_balance"
      stock_closing_status: "draft" | "finalized"
      stock_variance_type: "balanced" | "shortage" | "surplus"
      supplier_ledger_type:
        | "opening_balance"
        | "manual_purchase"
        | "manual_payment"
        | "adjustment_increase"
        | "adjustment_decrease"
        | "reversed_purchase"
        | "reversed_payment"
        | "reversed_manual_purchase"
        | "reversed_manual_payment"
        | "reversed_adjustment_increase"
        | "reversed_adjustment_decrease"
        | "reversed_opening_balance"
      system_error_severity: "info" | "warning" | "error" | "critical"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff", "super_admin", "manager"],
      health_status: ["green", "yellow", "red"],
      job_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "dead",
      ],
      notification_priority: ["low", "normal", "high", "critical"],
      notification_type: [
        "purchase_created",
        "purchase_reversed",
        "supply_created",
        "supply_reversed",
        "recovery_created",
        "recovery_reversed",
        "expense_created",
        "farm_payment_created",
        "farm_payment_reversed",
        "customer_payment_created",
        "stock_closing_created",
        "stock_adjustment_created",
        "stock_adjustment_reversed",
        "ledger_entry_created",
        "ledger_entry_reversed",
        "daily_closing_finalized",
        "factory_reset",
        "business_reset",
        "backup_created",
        "backup_restored",
        "backup_failed",
        "user_created",
        "user_updated",
        "user_removed",
        "permission_changed",
        "role_permission_changed",
        "password_changed",
        "login_alert",
        "super_admin_login",
        "system",
        "subscription_expiring",
        "subscription_expired",
      ],
      shop_ledger_type: [
        "opening_balance",
        "manual_supply",
        "manual_payment",
        "adjustment_increase",
        "adjustment_decrease",
        "recovery",
        "reversed_recovery",
        "reversed_supply",
        "reversed_manual_supply",
        "reversed_manual_payment",
        "reversed_adjustment_increase",
        "reversed_adjustment_decrease",
        "reversed_opening_balance",
      ],
      stock_closing_status: ["draft", "finalized"],
      stock_variance_type: ["balanced", "shortage", "surplus"],
      supplier_ledger_type: [
        "opening_balance",
        "manual_purchase",
        "manual_payment",
        "adjustment_increase",
        "adjustment_decrease",
        "reversed_purchase",
        "reversed_payment",
        "reversed_manual_purchase",
        "reversed_manual_payment",
        "reversed_adjustment_increase",
        "reversed_adjustment_decrease",
        "reversed_opening_balance",
      ],
      system_error_severity: ["info", "warning", "error", "critical"],
    },
  },
} as const
