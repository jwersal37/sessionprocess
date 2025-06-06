// Advanced analytics and reporting utility
import { ref, onValue, get, update, push, remove } from 'firebase/database';
import { database } from '../firebase';

export interface MessageAnalytics {
  messageId: string;
  userId: string;
  timestamp: number;
  length: number;
  wordCount: number;
  sentiment?: {
    score: number;
    comparative: number;
    positive: string[];
    negative: string[];
  };
  flagged: boolean;
  deleted: boolean;
  responseTime?: number; // Time between messages
  channelId?: string;
}

export interface UserBehaviorMetrics {
  userId: string;
  email: string;
  displayName?: string;
  totalMessages: number;
  averageMessageLength: number;
  averageWordsPerMessage: number;
  messagesPerHour: number;
  peakActivityHours: number[];
  sentimentTrend: Array<{ date: string; avgSentiment: number }>;
  flaggedMessageRatio: number;
  responseTimeAvg: number;
  topKeywords: Array<{ word: string; count: number }>;
  riskScore: number; // 0-100, higher = more risky behavior
  lastActivity: number;
}

export interface ChatAnalytics {
  totalMessages: number;
  totalUsers: number;
  activeUsers24h: number;
  averageMessagesPerUser: number;
  peakHours: Array<{ hour: number; messageCount: number }>;
  sentimentOverTime: Array<{ date: string; avgSentiment: number; messageCount: number }>;
  moderationStats: {
    totalFlagged: number;
    autoFlagged: number;
    manualFlagged: number;
    deletedMessages: number;
    approvedMessages: number;
    flaggedRatio: number;
  };
  topUsers: Array<{ userId: string; email: string; messageCount: number }>;
  wordCloud: Array<{ word: string; frequency: number }>;
  channelStats: Record<string, { messageCount: number; userCount: number }>;
}

export interface ModerationEffectiveness {
  totalReviews: number;
  avgReviewTime: number; // minutes
  accuracyRate: number; // % of auto-flags that were correctly identified
  falsePositiveRate: number;
  missedViolations: number;
  moderatorPerformance: Array<{
    moderatorId: string;
    email: string;
    reviewCount: number;
    avgReviewTime: number;
    accuracyRate: number;
  }>;
  ruleEffectiveness: Array<{
    ruleId: string;
    ruleName: string;
    triggeredCount: number;
    correctFlags: number;
    falsePositives: number;
    effectiveness: number; // %
  }>;
}

export interface AnalyticsReport {
  id: string;
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  startDate: number;
  endDate: number;
  generatedAt: number;
  generatedBy: string;
  chatAnalytics: ChatAnalytics;
  userBehaviorMetrics: UserBehaviorMetrics[];
  moderationEffectiveness: ModerationEffectiveness;
  insights: string[];
  recommendations: string[];
}

export class AnalyticsManager {
  private messagesRef = ref(database, 'messages');
  private usersRef = ref(database, 'users');
  private flaggedMessagesRef = ref(database, 'flaggedMessages');
  private reportsRef = ref(database, 'analyticsReports');

  // Simple sentiment analysis (in production, use a proper sentiment analysis library)
  private analyzeSentiment(text: string): { score: number; comparative: number; positive: string[]; negative: string[] } {
    const positiveWords = ['good', 'great', 'awesome', 'excellent', 'love', 'like', 'happy', 'amazing', 'wonderful', 'fantastic'];
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'dislike', 'sad', 'angry', 'horrible', 'disgusting', 'annoying'];
    
    const words = text.toLowerCase().split(/\s+/);
    const positive: string[] = [];
    const negative: string[] = [];
    let score = 0;

    words.forEach(word => {
      if (positiveWords.includes(word)) {
        positive.push(word);
        score += 1;
      }
      if (negativeWords.includes(word)) {
        negative.push(word);
        score -= 1;
      }
    });

    return {
      score,
      comparative: words.length > 0 ? score / words.length : 0,
      positive,
      negative
    };
  }

  // Extract keywords from text
  private extractKeywords(text: string): string[] {
    const stopWords = ['the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'are', 'as', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall', 'of', 'in', 'for', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'under', 'over', 'out', 'off', 'down', 'than', 'but', 'or', 'nor', 'so', 'yet', 'if', 'then', 'else', 'when', 'where', 'why', 'how', 'what', 'who', 'whom', 'whose', 'which', 'that', 'this', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their'];
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));
  }

  // Calculate risk score for user
  private calculateRiskScore(userBehavior: Partial<UserBehaviorMetrics>): number {
    let riskScore = 0;

    // High message frequency (potential spam)
    if (userBehavior.messagesPerHour && userBehavior.messagesPerHour > 10) {
      riskScore += 20;
    }

    // High flagged message ratio
    if (userBehavior.flaggedMessageRatio && userBehavior.flaggedMessageRatio > 0.1) {
      riskScore += 30;
    }    // Negative sentiment trend
    const avgSentiment = userBehavior.sentimentTrend && userBehavior.sentimentTrend.length > 0
      ? userBehavior.sentimentTrend.reduce((sum, item) => sum + item.avgSentiment, 0) / userBehavior.sentimentTrend.length
      : 0;
    if (avgSentiment < -0.5) {
      riskScore += 25;
    }

    // Very short response times (potential bot behavior)
    if (userBehavior.responseTimeAvg && userBehavior.responseTimeAvg < 5000) { // Less than 5 seconds
      riskScore += 15;
    }

    // Short message length (potential spam)
    if (userBehavior.averageMessageLength && userBehavior.averageMessageLength < 10) {
      riskScore += 10;
    }

    return Math.min(riskScore, 100);
  }

  // Analyze user behavior patterns
  async analyzeUserBehavior(userId: string, days: number = 30): Promise<UserBehaviorMetrics | null> {
    try {
      const [messagesSnapshot, userSnapshot, flaggedSnapshot] = await Promise.all([
        get(this.messagesRef),
        get(ref(database, `users/${userId}`)),
        get(this.flaggedMessagesRef)
      ]);

      const messages = messagesSnapshot.val() || {};
      const user = userSnapshot.val();
      const flaggedMessages = flaggedSnapshot.val() || {};

      if (!user) return null;      const userMessages = Object.values(messages)
        .filter((msg: any) => msg.userId === userId && msg.timestamp > Date.now() - (days * 24 * 60 * 60 * 1000))
        .sort((a: any, b: any) => a.timestamp - b.timestamp) as Array<{timestamp: number, text: string, userId: string}>;

      if (userMessages.length === 0) {
        return {
          userId,
          email: user.email,
          displayName: user.displayName,
          totalMessages: 0,
          averageMessageLength: 0,
          averageWordsPerMessage: 0,
          messagesPerHour: 0,
          peakActivityHours: [],
          sentimentTrend: [],
          flaggedMessageRatio: 0,
          responseTimeAvg: 0,
          topKeywords: [],
          riskScore: 0,
          lastActivity: user.lastActive || 0
        };
      }

      // Calculate metrics
      const totalMessages = userMessages.length;
      const totalLength = userMessages.reduce((sum: number, msg: any) => sum + msg.text.length, 0);
      const totalWords = userMessages.reduce((sum: number, msg: any) => sum + msg.text.split(/\s+/).length, 0);
      const averageMessageLength = totalLength / totalMessages;
      const averageWordsPerMessage = totalWords / totalMessages;

      // Messages per hour
      const timeSpan = userMessages[userMessages.length - 1].timestamp - userMessages[0].timestamp;
      const messagesPerHour = timeSpan > 0 ? (totalMessages / (timeSpan / (1000 * 60 * 60))) : 0;

      // Peak activity hours
      const hourCounts: Record<number, number> = {};
      userMessages.forEach((msg: any) => {
        const hour = new Date(msg.timestamp).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      });
      const peakActivityHours = Object.entries(hourCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([hour]) => parseInt(hour));

      // Sentiment trend (weekly buckets)
      const sentimentTrend: Array<{ date: string; avgSentiment: number }> = [];
      const weekBuckets: Record<string, number[]> = {};
      
      userMessages.forEach((msg: any) => {
        const sentiment = this.analyzeSentiment(msg.text);
        const weekStart = new Date(msg.timestamp);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekKey = weekStart.toISOString().split('T')[0];
        
        if (!weekBuckets[weekKey]) weekBuckets[weekKey] = [];
        weekBuckets[weekKey].push(sentiment.comparative);
      });

      Object.entries(weekBuckets).forEach(([date, sentiments]) => {
        const avgSentiment = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;
        sentimentTrend.push({ date, avgSentiment });
      });

      // Flagged message ratio
      const userFlaggedMessages = Object.values(flaggedMessages).filter((flag: any) => flag.userId === userId);
      const flaggedMessageRatio = userFlaggedMessages.length / totalMessages;

      // Response time analysis
      const responseTimes: number[] = [];
      for (let i = 1; i < userMessages.length; i++) {
        const timeDiff = userMessages[i].timestamp - userMessages[i - 1].timestamp;
        if (timeDiff < 5 * 60 * 1000) { // Less than 5 minutes = likely response
          responseTimes.push(timeDiff);
        }
      }
      const responseTimeAvg = responseTimes.length > 0 
        ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
        : 0;

      // Top keywords
      const allKeywords: string[] = [];
      userMessages.forEach((msg: any) => {
        allKeywords.push(...this.extractKeywords(msg.text));
      });
      
      const keywordCounts: Record<string, number> = {};
      allKeywords.forEach(keyword => {
        keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
      });
      
      const topKeywords = Object.entries(keywordCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([word, count]) => ({ word, count }));

      const userBehavior: UserBehaviorMetrics = {
        userId,
        email: user.email,
        displayName: user.displayName,
        totalMessages,
        averageMessageLength,
        averageWordsPerMessage,
        messagesPerHour,
        peakActivityHours,
        sentimentTrend,
        flaggedMessageRatio,
        responseTimeAvg,
        topKeywords,
        riskScore: 0, // Will be calculated next
        lastActivity: user.lastActive || 0
      };

      userBehavior.riskScore = this.calculateRiskScore(userBehavior);

      return userBehavior;
    } catch (error) {
      console.error('Error analyzing user behavior:', error);
      return null;
    }
  }

  // Generate comprehensive chat analytics
  async generateChatAnalytics(days: number = 30): Promise<ChatAnalytics> {
    try {
      const [messagesSnapshot, usersSnapshot, flaggedSnapshot] = await Promise.all([
        get(this.messagesRef),
        get(this.usersRef),
        get(this.flaggedMessagesRef)
      ]);

      const messages = messagesSnapshot.val() || {};
      const users = usersSnapshot.val() || {};
      const flaggedMessages = flaggedSnapshot.val() || {};

      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      const recentMessages = Object.values(messages).filter((msg: any) => msg.timestamp > cutoffTime);
      const last24hMessages = Object.values(messages).filter((msg: any) => msg.timestamp > Date.now() - (24 * 60 * 60 * 1000));

      // Basic stats
      const totalMessages = recentMessages.length;
      const totalUsers = Object.keys(users).length;
      const activeUsers24h = new Set(last24hMessages.map((msg: any) => msg.userId)).size;
      const averageMessagesPerUser = totalUsers > 0 ? totalMessages / totalUsers : 0;

      // Peak hours analysis
      const hourCounts: Record<number, number> = {};
      recentMessages.forEach((msg: any) => {
        const hour = new Date(msg.timestamp).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      });
      const peakHours = Object.entries(hourCounts)
        .map(([hour, count]) => ({ hour: parseInt(hour), messageCount: count }))
        .sort((a, b) => b.messageCount - a.messageCount);

      // Sentiment over time (daily buckets)
      const sentimentOverTime: Array<{ date: string; avgSentiment: number; messageCount: number }> = [];
      const dayBuckets: Record<string, { sentiments: number[]; count: number }> = {};
      
      recentMessages.forEach((msg: any) => {
        const sentiment = this.analyzeSentiment(msg.text);
        const day = new Date(msg.timestamp).toISOString().split('T')[0];
        
        if (!dayBuckets[day]) dayBuckets[day] = { sentiments: [], count: 0 };
        dayBuckets[day].sentiments.push(sentiment.comparative);
        dayBuckets[day].count++;
      });

      Object.entries(dayBuckets).forEach(([date, data]) => {
        const avgSentiment = data.sentiments.reduce((sum, s) => sum + s, 0) / data.sentiments.length;
        sentimentOverTime.push({ date, avgSentiment, messageCount: data.count });
      });

      // Moderation stats
      const flaggedMessagesList = Object.values(flaggedMessages);
      const recentFlagged = flaggedMessagesList.filter((flag: any) => flag.flaggedAt > cutoffTime);
      const autoFlagged = recentFlagged.filter((flag: any) => flag.autoFlagged);
      const deletedMessages = recentFlagged.filter((flag: any) => flag.action === 'deleted');
      const approvedMessages = recentFlagged.filter((flag: any) => flag.action === 'approved');

      const moderationStats = {
        totalFlagged: recentFlagged.length,
        autoFlagged: autoFlagged.length,
        manualFlagged: recentFlagged.length - autoFlagged.length,
        deletedMessages: deletedMessages.length,
        approvedMessages: approvedMessages.length,
        flaggedRatio: totalMessages > 0 ? recentFlagged.length / totalMessages : 0
      };

      // Top users
      const userMessageCounts: Record<string, number> = {};
      recentMessages.forEach((msg: any) => {
        if (msg.userId) {
          userMessageCounts[msg.userId] = (userMessageCounts[msg.userId] || 0) + 1;
        }
      });
      
      const topUsers = Object.entries(userMessageCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([userId, messageCount]) => ({
          userId,
          email: users[userId]?.email || 'Unknown',
          messageCount
        }));

      // Word cloud
      const allWords: string[] = [];
      recentMessages.forEach((msg: any) => {
        allWords.push(...this.extractKeywords(msg.text));
      });
      
      const wordCounts: Record<string, number> = {};
      allWords.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      });
      
      const wordCloud = Object.entries(wordCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 50)
        .map(([word, frequency]) => ({ word, frequency }));

      // Channel stats (for future multi-channel support)
      const channelStats: Record<string, { messageCount: number; userCount: number }> = {
        general: {
          messageCount: totalMessages,
          userCount: new Set(recentMessages.map((msg: any) => msg.userId)).size
        }
      };

      return {
        totalMessages,
        totalUsers,
        activeUsers24h,
        averageMessagesPerUser,
        peakHours,
        sentimentOverTime,
        moderationStats,
        topUsers,
        wordCloud,
        channelStats
      };
    } catch (error) {
      console.error('Error generating chat analytics:', error);
      throw error;
    }
  }

  // Analyze moderation effectiveness
  async analyzeModerationEffectiveness(days: number = 30): Promise<ModerationEffectiveness> {
    try {
      const flaggedSnapshot = await get(this.flaggedMessagesRef);
      const flaggedMessages = flaggedSnapshot.val() || {};

      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      const recentFlagged = Object.values(flaggedMessages)
        .filter((flag: any) => flag.flaggedAt > cutoffTime && flag.reviewed);

      const totalReviews = recentFlagged.length;
      
      // Calculate average review time
      const reviewTimes = recentFlagged
        .filter((flag: any) => flag.reviewedAt && flag.flaggedAt)
        .map((flag: any) => flag.reviewedAt - flag.flaggedAt);
      const avgReviewTime = reviewTimes.length > 0 
        ? reviewTimes.reduce((sum, time) => sum + time, 0) / reviewTimes.length / (1000 * 60) // Convert to minutes
        : 0;

      // Accuracy analysis (simplified - assumes deleted = correct flag, approved = incorrect flag)
      const correctFlags = recentFlagged.filter((flag: any) => flag.action === 'deleted').length;
      const incorrectFlags = recentFlagged.filter((flag: any) => flag.action === 'approved').length;
      const accuracyRate = totalReviews > 0 ? (correctFlags / totalReviews) * 100 : 0;
      const falsePositiveRate = totalReviews > 0 ? (incorrectFlags / totalReviews) * 100 : 0;

      // Moderator performance
      const moderatorStats: Record<string, any> = {};
      recentFlagged.forEach((flag: any) => {
        if (flag.reviewedBy) {
          if (!moderatorStats[flag.reviewedBy]) {
            moderatorStats[flag.reviewedBy] = {
              reviewCount: 0,
              reviewTimes: [],
              correctDecisions: 0
            };
          }
          moderatorStats[flag.reviewedBy].reviewCount++;
          if (flag.reviewedAt && flag.flaggedAt) {
            moderatorStats[flag.reviewedBy].reviewTimes.push(flag.reviewedAt - flag.flaggedAt);
          }
          if (flag.action === 'deleted') {
            moderatorStats[flag.reviewedBy].correctDecisions++;
          }
        }
      });

      const moderatorPerformance = Object.entries(moderatorStats).map(([moderatorId, stats]: [string, any]) => ({
        moderatorId,
        email: 'moderator@example.com', // Would fetch from users table in real implementation
        reviewCount: stats.reviewCount,
        avgReviewTime: stats.reviewTimes.length > 0 
          ? stats.reviewTimes.reduce((sum: number, time: number) => sum + time, 0) / stats.reviewTimes.length / (1000 * 60)
          : 0,
        accuracyRate: stats.reviewCount > 0 ? (stats.correctDecisions / stats.reviewCount) * 100 : 0
      }));

      // Rule effectiveness (simplified analysis)
      const ruleStats: Record<string, any> = {};
      recentFlagged.forEach((flag: any) => {
        const ruleId = flag.flagReason || 'unknown';
        if (!ruleStats[ruleId]) {
          ruleStats[ruleId] = {
            triggeredCount: 0,
            correctFlags: 0,
            falsePositives: 0
          };
        }
        ruleStats[ruleId].triggeredCount++;
        if (flag.action === 'deleted') {
          ruleStats[ruleId].correctFlags++;
        } else if (flag.action === 'approved') {
          ruleStats[ruleId].falsePositives++;
        }
      });

      const ruleEffectiveness = Object.entries(ruleStats).map(([ruleId, stats]: [string, any]) => ({
        ruleId,
        ruleName: ruleId.charAt(0).toUpperCase() + ruleId.slice(1),
        triggeredCount: stats.triggeredCount,
        correctFlags: stats.correctFlags,
        falsePositives: stats.falsePositives,
        effectiveness: stats.triggeredCount > 0 ? (stats.correctFlags / stats.triggeredCount) * 100 : 0
      }));

      return {
        totalReviews,
        avgReviewTime,
        accuracyRate,
        falsePositiveRate,
        missedViolations: 0, // Would require manual analysis
        moderatorPerformance,
        ruleEffectiveness
      };
    } catch (error) {
      console.error('Error analyzing moderation effectiveness:', error);
      throw error;
    }
  }

  // Generate comprehensive analytics report
  async generateReport(
    type: 'daily' | 'weekly' | 'monthly' | 'custom',
    startDate?: number,
    endDate?: number,
    generatedBy: string = 'system'
  ): Promise<AnalyticsReport> {
    try {
      let days: number;
      let actualStartDate: number;
      let actualEndDate: number = Date.now();

      switch (type) {
        case 'daily':
          days = 1;
          actualStartDate = Date.now() - (24 * 60 * 60 * 1000);
          break;
        case 'weekly':
          days = 7;
          actualStartDate = Date.now() - (7 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
          days = 30;
          actualStartDate = Date.now() - (30 * 24 * 60 * 60 * 1000);
          break;
        case 'custom':
          if (!startDate || !endDate) {
            throw new Error('Start and end dates required for custom reports');
          }
          actualStartDate = startDate;
          actualEndDate = endDate;
          days = Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));
          break;
        default:
          throw new Error('Invalid report type');
      }

      const [chatAnalytics, moderationEffectiveness] = await Promise.all([
        this.generateChatAnalytics(days),
        this.analyzeModerationEffectiveness(days)
      ]);

      // Get behavior metrics for top users
      const userBehaviorPromises = chatAnalytics.topUsers.slice(0, 5).map(user => 
        this.analyzeUserBehavior(user.userId, days)
      );
      const userBehaviorResults = await Promise.all(userBehaviorPromises);
      const userBehaviorMetrics = userBehaviorResults.filter(Boolean) as UserBehaviorMetrics[];

      // Generate insights
      const insights: string[] = [];
      const recommendations: string[] = [];

      // Analytics insights
      if (chatAnalytics.activeUsers24h < chatAnalytics.totalUsers * 0.1) {
        insights.push('Low user engagement: Only ' + Math.round((chatAnalytics.activeUsers24h / chatAnalytics.totalUsers) * 100) + '% of users were active in the last 24 hours');
        recommendations.push('Consider implementing engagement features like notifications or daily challenges');
      }

      if (chatAnalytics.moderationStats.flaggedRatio > 0.05) {
        insights.push('High moderation load: ' + Math.round(chatAnalytics.moderationStats.flaggedRatio * 100) + '% of messages are being flagged');
        recommendations.push('Review and optimize moderation rules to reduce false positives');
      }

      if (moderationEffectiveness.avgReviewTime > 60) {
        insights.push('Slow moderation response: Average review time is ' + Math.round(moderationEffectiveness.avgReviewTime) + ' minutes');
        recommendations.push('Add more moderators or implement auto-moderation for clear violations');
      }

      // High-risk users
      const highRiskUsers = userBehaviorMetrics.filter(user => user.riskScore > 70);
      if (highRiskUsers.length > 0) {
        insights.push(`${highRiskUsers.length} users identified as high-risk based on behavior patterns`);
        recommendations.push('Review high-risk users for potential policy violations');
      }

      // Sentiment trends
      const recentSentiment = chatAnalytics.sentimentOverTime.slice(-7);
      const avgRecentSentiment = recentSentiment.reduce((sum, day) => sum + day.avgSentiment, 0) / recentSentiment.length;
      if (avgRecentSentiment < -0.2) {
        insights.push('Declining conversation sentiment detected');
        recommendations.push('Consider community-building initiatives or content moderation adjustments');
      }

      const reportId = push(this.reportsRef).key!;
      const report: AnalyticsReport = {
        id: reportId,
        type,
        startDate: actualStartDate,
        endDate: actualEndDate,
        generatedAt: Date.now(),
        generatedBy,
        chatAnalytics,
        userBehaviorMetrics,
        moderationEffectiveness,
        insights,
        recommendations
      };

      // Save report
      await update(ref(database, `analyticsReports/${reportId}`), report);

      return report;
    } catch (error) {
      console.error('Error generating analytics report:', error);
      throw error;
    }
  }

  // Monitor analytics in real-time
  monitorAnalytics(callback: (analytics: Partial<ChatAnalytics>) => void): () => void {
    return onValue(this.messagesRef, async () => {
      try {
        // Generate lightweight analytics for real-time monitoring
        const analytics = await this.generateChatAnalytics(1); // Last 24 hours
        callback(analytics);
      } catch (error) {
        console.error('Error in real-time analytics monitoring:', error);
      }
    });
  }

  // Get saved reports
  async getReports(limit: number = 10): Promise<AnalyticsReport[]> {
    try {
      const snapshot = await get(this.reportsRef);
      const reports = snapshot.val() || {};
      
      return Object.values(reports)
        .sort((a: any, b: any) => b.generatedAt - a.generatedAt)
        .slice(0, limit) as AnalyticsReport[];
    } catch (error) {
      console.error('Error getting reports:', error);
      return [];
    }
  }

  // Delete old reports (cleanup)
  async cleanupOldReports(daysToKeep: number = 90): Promise<void> {
    try {
      const snapshot = await get(this.reportsRef);
      const reports = snapshot.val() || {};
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);      const deletions = Object.entries(reports)
        .filter(([, report]: [string, any]) => report.generatedAt < cutoffTime)
        .map(([reportId]) => remove(ref(database, `analyticsReports/${reportId}`)));

      await Promise.all(deletions);
    } catch (error) {
      console.error('Error cleaning up old reports:', error);
    }
  }
}
