export interface Teacher {
  id: string;
  name: string;
  evolutionInstance: string;
  phoneE164: string;
  externalRef: string | null;
  createdAt: string;
  welcomeSentAt: string | null;
}

export interface Student {
  id: string;
  teacherId: string;
  name: string;
  classId: string | null;
  externalRef: string | null;
  createdAt: string;
}

export interface Guardian {
  id: string;
  teacherId: string;
  name: string;
  phoneE164: string;
  role: string;
  isActive: number; // 1 = active, 0 = soft-deactivated
  createdAt: string;
}

export interface StudentGuardian {
  studentId: string;
  guardianId: string;
}

export interface DispatchedMessage {
  id: string;
  teacherId: string;
  broadcastGroupId: string | null;
  studentId: string | null;
  guardianId: string;
  draftText: string;
  bodyText: string;
  status: "pending" | "sent" | "failed";
  providerMessageId: string | null;
  createdAt: string;
  sentAt: string | null;
  failedReason: string | null;
}

export interface DeliveryEvent {
  id: number;
  dispatchedMessageId: string;
  status: "delivered" | "read";
  observedAt: string;
}

export interface Acknowledgement {
  dispatchedMessageId: string;
  inboundMessageId: string;
  acknowledgedAt: string;
}

export interface InboundMessage {
  id: string;
  teacherId: string;
  guardianId: string | null;
  providerMessageId: string | null;
  bodyText: string;
  normalizedText: string;
  receivedAt: string;
}
