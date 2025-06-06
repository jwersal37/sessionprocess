// Enhanced message moderation utility with real-time flagging
import { ref, onValue, remove, update } from 'firebase/database';
import { database } from '../firebase';

export interface FlaggedMessage {
  id: string;
  text: string;
  user: string;
  userId?: string;
  timestamp: number;
  flagReason: 'profanity' | 'spam' | 'harassment' | 'inappropriate' | 'manual';
  flaggedAt: number;
  flaggedBy?: string; // userId who flagged it (if manual)
  autoFlagged: boolean;
  severity: 'low' | 'medium' | 'high';
  reviewed: boolean;
  reviewedBy?: string;
  reviewedAt?: number;
  action?: 'approved' | 'deleted' | 'edited';
}

export interface ModerationRule {
  id: string;
  name: string;
  type: 'keyword' | 'pattern' | 'length' | 'caps' | 'repetition';
  value: string | number;
  action: 'flag' | 'auto-delete' | 'warn';
  severity: 'low' | 'medium' | 'high';
  enabled: boolean;
}

// Enhanced profanity and problematic content detection
const PROFANITY_LEVELS = {
  mild: ['damn', 'hell', 'crap', 'stupid', 'idiot', 'moron', 'dumb'],
  moderate: ['hate', 'kill', 'die', 'trash', 'garbage', 'worthless'],
  severe: ['extreme profanity would go here'] // In production, use a comprehensive library
};

const HARASSMENT_PATTERNS = [
  /you\s+(should|need to)\s+(die|kill yourself)/i,
  /kys/i, // "kill yourself" abbreviation
  /go\s+kill\s+yourself/i,
  /nobody\s+likes\s+you/i,
  /you\s+are\s+(worthless|pathetic|disgusting)/i
];

const SPAM_PATTERNS = [
  /(.)\1{5,}/i, // Repeated characters (aaaaaa)
  /^[A-Z\s!]{15,}$/i, // All caps messages (longer threshold)
  /(\b\w+\b.*?){3,}\1/i, // Repeated words/phrases
  /(https?:\/\/[^\s]+)/gi, // URLs
  /(\b\d{10,}\b)/g, // Long number sequences (phone numbers, etc.)
];

export class MessageModerator {
  private flaggedMessagesRef = ref(database, 'flaggedMessages');
  private moderationRulesRef = ref(database, 'moderationRules');
  
  // Default moderation rules
  private defaultRules: ModerationRule[] = [
    {
      id: 'profanity-mild',
      name: 'Mild Profanity',
      type: 'keyword',
      value: PROFANITY_LEVELS.mild.join('|'),
      action: 'flag',
      severity: 'low',
      enabled: true
    },
    {
      id: 'profanity-severe',
      name: 'Severe Profanity',
      type: 'keyword', 
      value: PROFANITY_LEVELS.severe.join('|'),
      action: 'auto-delete',
      severity: 'high',
      enabled: true
    },
    {
      id: 'harassment',
      name: 'Harassment Patterns',
      type: 'pattern',
      value: HARASSMENT_PATTERNS.map(p => p.source).join('|'),
      action: 'auto-delete',
      severity: 'high',
      enabled: true
    },
    {
      id: 'spam-repetition',
      name: 'Spam Repetition',
      type: 'pattern',
      value: SPAM_PATTERNS.map(p => p.source).join('|'),
      action: 'flag',
      severity: 'medium',
      enabled: true
    },
    {
      id: 'message-length',
      name: 'Excessive Length',
      type: 'length',
      value: 1000,
      action: 'flag',
      severity: 'low',
      enabled: true
    }
  ];

  async initializeRules(): Promise<void> {
    // Initialize default rules if they don't exist
    try {
      const snapshot = await new Promise((resolve) => {
        onValue(this.moderationRulesRef, resolve, { onlyOnce: true });
      });
      
      if (!(snapshot as any).val()) {
        const rulesObject = this.defaultRules.reduce((acc, rule) => {
          acc[rule.id] = rule;
          return acc;
        }, {} as Record<string, ModerationRule>);
        
        await update(this.moderationRulesRef, rulesObject);
      }
    } catch (error) {
      console.error('Error initializing moderation rules:', error);
    }
  }

  moderateMessage(message: string, _userId: string, _messageId: string): {
    shouldFlag: boolean;
    shouldDelete: boolean;
    flagReason?: FlaggedMessage['flagReason'];
    severity?: FlaggedMessage['severity'];
  } {
    const lowerMessage = message.toLowerCase();
    
    // Check for severe profanity - auto-delete
    for (const word of PROFANITY_LEVELS.severe) {
      if (lowerMessage.includes(word.toLowerCase())) {
        return {
          shouldFlag: true,
          shouldDelete: true,
          flagReason: 'profanity',
          severity: 'high'
        };
      }
    }

    // Check for harassment patterns - auto-delete
    for (const pattern of HARASSMENT_PATTERNS) {
      if (pattern.test(message)) {
        return {
          shouldFlag: true,
          shouldDelete: true,
          flagReason: 'harassment',
          severity: 'high'
        };
      }
    }

    // Check for moderate profanity - flag only
    for (const word of PROFANITY_LEVELS.moderate) {
      if (lowerMessage.includes(word.toLowerCase())) {
        return {
          shouldFlag: true,
          shouldDelete: false,
          flagReason: 'profanity',
          severity: 'medium'
        };
      }
    }

    // Check for mild profanity - flag only
    for (const word of PROFANITY_LEVELS.mild) {
      if (lowerMessage.includes(word.toLowerCase())) {
        return {
          shouldFlag: true,
          shouldDelete: false,
          flagReason: 'profanity',
          severity: 'low'
        };
      }
    }

    // Check for spam patterns
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(message)) {
        return {
          shouldFlag: true,
          shouldDelete: false,
          flagReason: 'spam',
          severity: 'medium'
        };
      }
    }

    // Check message length
    if (message.length > 800) {
      return {
        shouldFlag: true,
        shouldDelete: false,
        flagReason: 'inappropriate',
        severity: 'low'
      };
    }

    return { shouldFlag: false, shouldDelete: false };
  }

  async flagMessage(
    messageData: {
      id: string;
      text: string;
      user: string;
      userId?: string;
      timestamp: number;
    },
    flagReason: FlaggedMessage['flagReason'],
    severity: FlaggedMessage['severity'],
    flaggedBy?: string,
    autoFlagged: boolean = true
  ): Promise<boolean> {
    try {
      const flaggedMessage: FlaggedMessage = {
        ...messageData,
        flagReason,
        flaggedAt: Date.now(),
        flaggedBy,
        autoFlagged,
        severity,
        reviewed: false
      };

      const flaggedMessageRef = ref(database, `flaggedMessages/${messageData.id}`);
      await update(flaggedMessageRef, flaggedMessage);
      
      return true;
    } catch (error) {
      console.error('Error flagging message:', error);
      return false;
    }
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      const messageRef = ref(database, `messages/${messageId}`);
      await remove(messageRef);
      return true;
    } catch (error) {
      console.error('Error deleting message:', error);
      return false;
    }
  }

  async reviewFlaggedMessage(
    messageId: string,
    reviewerId: string,
    action: 'approved' | 'deleted' | 'edited'
  ): Promise<boolean> {
    try {
      const flaggedMessageRef = ref(database, `flaggedMessages/${messageId}`);
      await update(flaggedMessageRef, {
        reviewed: true,
        reviewedBy: reviewerId,
        reviewedAt: Date.now(),
        action
      });

      // If action is delete, remove the original message
      if (action === 'deleted') {
        await this.deleteMessage(messageId);
      }

      return true;
    } catch (error) {
      console.error('Error reviewing flagged message:', error);
      return false;
    }
  }

  // Get all flagged messages for admin review
  monitorFlaggedMessages(callback: (flaggedMessages: FlaggedMessage[]) => void): () => void {
    const unsubscribe = onValue(this.flaggedMessagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const flaggedMessages = Object.keys(data).map(key => ({
          ...data[key],
          id: key
        })).sort((a, b) => b.flaggedAt - a.flaggedAt); // Most recent first
        
        callback(flaggedMessages);
      } else {
        callback([]);
      }
    });

    return unsubscribe;
  }

  // Get flagged messages by severity
  getFlaggedMessagesBySeverity(flaggedMessages: FlaggedMessage[], severity: FlaggedMessage['severity']): FlaggedMessage[] {
    return flaggedMessages.filter(msg => msg.severity === severity && !msg.reviewed);
  }

  // Get flagged messages by reason
  getFlaggedMessagesByReason(flaggedMessages: FlaggedMessage[], reason: FlaggedMessage['flagReason']): FlaggedMessage[] {
    return flaggedMessages.filter(msg => msg.flagReason === reason && !msg.reviewed);
  }

  // Get statistics for flagged messages
  getFlaggedMessagesStats(flaggedMessages: FlaggedMessage[]): {
    total: number;
    unreviewed: number;
    bySeverity: Record<FlaggedMessage['severity'], number>;
    byReason: Record<FlaggedMessage['flagReason'], number>;
    autoFlagged: number;
    manualFlagged: number;
  } {
    const unreviewed = flaggedMessages.filter(msg => !msg.reviewed);
    
    return {
      total: flaggedMessages.length,
      unreviewed: unreviewed.length,
      bySeverity: {
        low: unreviewed.filter(msg => msg.severity === 'low').length,
        medium: unreviewed.filter(msg => msg.severity === 'medium').length,
        high: unreviewed.filter(msg => msg.severity === 'high').length,
      },
      byReason: {
        profanity: unreviewed.filter(msg => msg.flagReason === 'profanity').length,
        spam: unreviewed.filter(msg => msg.flagReason === 'spam').length,
        harassment: unreviewed.filter(msg => msg.flagReason === 'harassment').length,
        inappropriate: unreviewed.filter(msg => msg.flagReason === 'inappropriate').length,
        manual: unreviewed.filter(msg => msg.flagReason === 'manual').length,
      },
      autoFlagged: unreviewed.filter(msg => msg.autoFlagged).length,
      manualFlagged: unreviewed.filter(msg => !msg.autoFlagged).length,
    };
  }
}
