export interface PartnerInfo {
  user_id: string;
  nombre: string;
  avatar_url?: string;
  carrera?: string;
  universidad?: string;
  tipo_estudiante?: string;
  xp_total?: number;
  racha_actual?: number;
  flashcards_estudiadas?: number;
  precision_global?: number;
  descripcion?: string;
}

export interface Partner {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
  partner: PartnerInfo;
}

export interface ChatPreview {
  id: string;
  user1_id: string;
  user2_id: string;
  last_message?: string;
  last_message_at?: string;
  partner: PartnerInfo;
  unread: number;
  savedCount: number;
  wallpaper_url?: string;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  type: string;
  metadata?: any;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  read_at?: string;
  edited_at?: string;
  deleted_at?: string;
  expires_at?: string;
  created_at: string;
}

export interface PendingAttachment {
  id: string;
  file: File;
  type: 'image' | 'audio' | 'file';
  preview?: string;
  name: string;
  size: number;
}
