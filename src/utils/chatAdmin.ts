// Admin utility for monitoring chat activity
// This can be used for moderation and analytics

import { ref, onValue, remove } from 'firebase/database';
import { database } from '../firebase';

interface ChatStats {
  totalMessages: number;
  activeUsers: Set<string>;
  messagesPerHour: number;
  topUsers: Array<{ user: string; count: number }>;
}

interface Message {
  id: string;
  text: string;
  user: string;
  userId?: string;
  timestamp: number;
}

export class ChatAdmin {
  private messagesRef = ref(database, 'messages');
  private unsubscribe: (() => void) | null = null;
  private messages: Message[] = [];

  startMonitoring(onStatsUpdate: (stats: ChatStats) => void) {
    this.unsubscribe = onValue(this.messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        this.messages = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a, b) => a.timestamp - b.timestamp);
        
        const stats = this.calculateStats();
        onStatsUpdate(stats);
      }
    });
  }

  stopMonitoring() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  // Add public getter for messages
  getMessages(): Message[] {
    return [...this.messages];
  }

  private calculateStats(): ChatStats {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    const recentMessages = this.messages.filter(msg => msg.timestamp > oneHourAgo);
    const activeUsers = new Set(this.messages.map(msg => msg.user));
    
    // Count messages per user
    const userCounts = new Map<string, number>();
    this.messages.forEach(msg => {
      const count = userCounts.get(msg.user) || 0;
      userCounts.set(msg.user, count + 1);
    });

    const topUsers = Array.from(userCounts.entries())
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalMessages: this.messages.length,
      activeUsers,
      messagesPerHour: recentMessages.length,
      topUsers
    };
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

  getMessagesWithKeywords(keywords: string[]): Message[] {
    return this.messages.filter(msg => 
      keywords.some(keyword => 
        msg.text.toLowerCase().includes(keyword.toLowerCase())
      )
    );
  }

  getMessagesByUser(userId: string): Message[] {
    return this.messages.filter(msg => msg.userId === userId);
  }

  exportChatHistory(): string {
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalMessages: this.messages.length,
      messages: this.messages.map(msg => ({
        timestamp: new Date(msg.timestamp).toISOString(),
        user: msg.user,
        text: msg.text
      }))
    };
    
    return JSON.stringify(exportData, null, 2);
  }
}
