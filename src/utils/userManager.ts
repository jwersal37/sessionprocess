// User management utility for admin controls
import { ref, onValue, update, push, get } from 'firebase/database';
import { database } from '../firebase';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: 'user' | 'moderator' | 'admin';
  status: 'active' | 'banned' | 'suspended';
  createdAt: number;
  lastActive: number;
  messageCount: number;
  flagCount: number; // Number of times user's messages were flagged
  warningCount: number;
  banHistory: BanRecord[];
  permissions: UserPermissions;
}

export interface BanRecord {
  id: string;
  userId: string;
  bannedBy: string;
  reason: string;
  type: 'temporary' | 'permanent';
  startDate: number;
  endDate?: number; // undefined for permanent bans
  isActive: boolean;
  revokedBy?: string;
  revokedAt?: number;
  revokeReason?: string;
}

export interface UserPermissions {
  canSendMessages: boolean;
  canDeleteOwnMessages: boolean;
  canReportMessages: boolean;
  canAccessAdminPanel: boolean;
  canModerateMessages: boolean;
  canBanUsers: boolean;
  canManageRoles: boolean;
}

export interface UserActivity {
  userId: string;
  action: 'login' | 'logout' | 'message_sent' | 'message_deleted' | 'user_reported' | 'message_flagged';
  timestamp: number;
  details?: any;
  ipAddress?: string;
}

export interface UserStats {
  totalUsers: number;
  activeUsers: number;
  bannedUsers: number;
  suspendedUsers: number;
  newUsersToday: number;
  mostActiveUsers: Array<{ uid: string; email: string; messageCount: number }>;
  recentActivity: UserActivity[];
}

export class UserManager {
  private usersRef = ref(database, 'users');
  private bansRef = ref(database, 'bans');
  private activityRef = ref(database, 'userActivity');
  
  private defaultPermissions: UserPermissions = {
    canSendMessages: true,
    canDeleteOwnMessages: true,
    canReportMessages: true,
    canAccessAdminPanel: false,
    canModerateMessages: false,
    canBanUsers: false,
    canManageRoles: false
  };

  private rolePermissions: Record<UserProfile['role'], UserPermissions> = {
    user: this.defaultPermissions,
    moderator: {
      ...this.defaultPermissions,
      canModerateMessages: true,
      canAccessAdminPanel: true
    },
    admin: {
      canSendMessages: true,
      canDeleteOwnMessages: true,
      canReportMessages: true,
      canAccessAdminPanel: true,
      canModerateMessages: true,
      canBanUsers: true,
      canManageRoles: true
    }
  };

  // Initialize or update user profile
  async initializeUser(uid: string, email: string, displayName?: string): Promise<void> {
    try {
      const userRef = ref(database, `users/${uid}`);
      const snapshot = await get(userRef);
      
      if (!snapshot.exists()) {
        // Create new user profile
        const newUser: UserProfile = {
          uid,
          email,
          displayName,
          role: this.isAdminEmail(email) ? 'admin' : 'user',
          status: 'active',
          createdAt: Date.now(),
          lastActive: Date.now(),
          messageCount: 0,
          flagCount: 0,
          warningCount: 0,
          banHistory: [],
          permissions: this.rolePermissions[this.isAdminEmail(email) ? 'admin' : 'user']
        };
        
        await update(userRef, newUser);
        await this.logActivity(uid, 'login', { firstLogin: true });
      } else {
        // Update last active time
        await update(userRef, { 
          lastActive: Date.now(),
          displayName: displayName || snapshot.val().displayName
        });
        await this.logActivity(uid, 'login');
      }
    } catch (error) {
      console.error('Error initializing user:', error);
    }
  }

  // Get user profile
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    try {
      const snapshot = await get(ref(database, `users/${uid}`));
      return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
      console.error('Error getting user profile:', error);
      return null;
    }
  }

  // Update user role
  async updateUserRole(uid: string, newRole: UserProfile['role'], updatedBy: string): Promise<boolean> {
    try {
      const userRef = ref(database, `users/${uid}`);
      const newPermissions = this.rolePermissions[newRole];
      
      await update(userRef, {
        role: newRole,
        permissions: newPermissions
      });

      await this.logActivity(updatedBy, 'user_reported', {
        action: 'role_updated',
        targetUser: uid,
        newRole
      });

      return true;
    } catch (error) {
      console.error('Error updating user role:', error);
      return false;
    }
  }

  // Ban user
  async banUser(
    userId: string, 
    bannedBy: string, 
    reason: string, 
    type: 'temporary' | 'permanent',
    duration?: number // hours for temporary ban
  ): Promise<boolean> {
    try {
      const banId = push(this.bansRef).key!;
      const startDate = Date.now();
      const endDate = type === 'temporary' && duration ? startDate + (duration * 60 * 60 * 1000) : undefined;

      const banRecord: BanRecord = {
        id: banId,
        userId,
        bannedBy,
        reason,
        type,
        startDate,
        endDate,
        isActive: true
      };

      // Create ban record
      await update(ref(database, `bans/${banId}`), banRecord);

      // Update user status
      const userRef = ref(database, `users/${userId}`);
      await update(userRef, {
        status: 'banned',
        [`banHistory/${banId}`]: banRecord
      });

      await this.logActivity(bannedBy, 'user_reported', {
        action: 'user_banned',
        targetUser: userId,
        reason,
        type,
        duration
      });

      return true;
    } catch (error) {
      console.error('Error banning user:', error);
      return false;
    }
  }

  // Unban user
  async unbanUser(userId: string, revokedBy: string, revokeReason: string): Promise<boolean> {
    try {
      // Find active ban
      const bansSnapshot = await get(this.bansRef);
      const bans = bansSnapshot.val() || {};
      
      const activeBan = Object.entries(bans).find(
        ([_, ban]: [string, any]) => ban.userId === userId && ban.isActive
      );

      if (!activeBan) {
        return false; // No active ban found
      }

      const [banId, _banData] = activeBan;

      // Revoke ban
      await update(ref(database, `bans/${banId}`), {
        isActive: false,
        revokedBy,
        revokedAt: Date.now(),
        revokeReason
      });

      // Update user status
      await update(ref(database, `users/${userId}`), {
        status: 'active'
      });

      await this.logActivity(revokedBy, 'user_reported', {
        action: 'user_unbanned',
        targetUser: userId,
        revokeReason
      });

      return true;
    } catch (error) {
      console.error('Error unbanning user:', error);
      return false;
    }
  }

  // Suspend user temporarily
  async suspendUser(userId: string, suspendedBy: string, reason: string, hours: number): Promise<boolean> {
    try {
      await update(ref(database, `users/${userId}`), {
        status: 'suspended',
        suspendedUntil: Date.now() + (hours * 60 * 60 * 1000),
        suspensionReason: reason
      });

      await this.logActivity(suspendedBy, 'user_reported', {
        action: 'user_suspended',
        targetUser: userId,
        reason,
        hours
      });

      return true;
    } catch (error) {
      console.error('Error suspending user:', error);
      return false;
    }
  }

  // Issue warning to user
  async warnUser(userId: string, warnedBy: string, reason: string): Promise<boolean> {
    try {
      const userRef = ref(database, `users/${userId}`);
      const snapshot = await get(userRef);
      const currentWarnings = snapshot.val()?.warningCount || 0;

      await update(userRef, {
        warningCount: currentWarnings + 1,
        lastWarning: {
          reason,
          issuedBy: warnedBy,
          issuedAt: Date.now()
        }
      });

      await this.logActivity(warnedBy, 'user_reported', {
        action: 'user_warned',
        targetUser: userId,
        reason
      });

      return true;
    } catch (error) {
      console.error('Error warning user:', error);
      return false;
    }
  }

  // Monitor all users
  monitorUsers(callback: (users: UserProfile[]) => void): () => void {
    const unsubscribe = onValue(this.usersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const users = Object.values(data) as UserProfile[];
        callback(users.sort((a, b) => b.lastActive - a.lastActive));
      } else {
        callback([]);
      }
    });

    return unsubscribe;
  }

  // Get user statistics
  async getUserStats(): Promise<UserStats> {
    try {
      const usersSnapshot = await get(this.usersRef);
      const users = Object.values(usersSnapshot.val() || {}) as UserProfile[];
      
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const oneHourAgo = now - (60 * 60 * 1000);

      const activeUsers = users.filter(user => user.lastActive > oneHourAgo).length;
      const bannedUsers = users.filter(user => user.status === 'banned').length;
      const suspendedUsers = users.filter(user => user.status === 'suspended').length;
      const newUsersToday = users.filter(user => user.createdAt > oneDayAgo).length;

      const mostActiveUsers = users
        .filter(user => user.messageCount > 0)
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 10)
        .map(user => ({
          uid: user.uid,
          email: user.email,
          messageCount: user.messageCount
        }));

      // Get recent activity
      const activitySnapshot = await get(ref(database, 'userActivity'));
      const activities = activitySnapshot.val() ? Object.values(activitySnapshot.val()) : [];
      const recentActivity = (activities as UserActivity[])
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50);

      return {
        totalUsers: users.length,
        activeUsers,
        bannedUsers,
        suspendedUsers,
        newUsersToday,
        mostActiveUsers,
        recentActivity
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      return {
        totalUsers: 0,
        activeUsers: 0,
        bannedUsers: 0,
        suspendedUsers: 0,
        newUsersToday: 0,
        mostActiveUsers: [],
        recentActivity: []
      };
    }
  }

  // Log user activity
  async logActivity(userId: string, action: UserActivity['action'], details?: any): Promise<void> {
    try {
      const activity: UserActivity = {
        userId,
        action,
        timestamp: Date.now(),
        details
      };

      await push(this.activityRef, activity);
    } catch (error) {
      console.error('Error logging activity:', error);
    }
  }

  // Update user message count
  async incrementMessageCount(userId: string): Promise<void> {
    try {
      const userRef = ref(database, `users/${userId}`);
      const snapshot = await get(userRef);
      const currentCount = snapshot.val()?.messageCount || 0;
      
      await update(userRef, {
        messageCount: currentCount + 1,
        lastActive: Date.now()
      });
    } catch (error) {
      console.error('Error updating message count:', error);
    }
  }

  // Update user flag count
  async incrementFlagCount(userId: string): Promise<void> {
    try {
      const userRef = ref(database, `users/${userId}`);
      const snapshot = await get(userRef);
      const currentCount = snapshot.val()?.flagCount || 0;
      
      await update(userRef, {
        flagCount: currentCount + 1
      });
    } catch (error) {
      console.error('Error updating flag count:', error);
    }
  }
  // Check if user can perform action
  async canUserPerformAction(userId: string, action: keyof UserPermissions): Promise<boolean> {
    try {
      const profile = await this.getUserProfile(userId);
      if (!profile) {
        return false;
      }

      // Check if suspension has expired
      if (profile.status === 'suspended' && (profile as any).suspendedUntil) {
        if (Date.now() > (profile as any).suspendedUntil) {
          await update(ref(database, `users/${userId}`), {
            status: 'active',
            suspendedUntil: null,
            suspensionReason: null
          });
          return profile.permissions[action] || false;
        }
        return false;
      }

      // Only allow actions if user is active
      if (profile.status !== 'active') {
        return false;
      }

      return profile.permissions[action] || false;
    } catch (error) {
      console.error('Error checking user permissions:', error);
      return false;
    }
  }

  // Helper method to check admin emails
  private isAdminEmail(email: string): boolean {
    const adminEmails = ['admin@sessionprocess.com', 'moderator@sessionprocess.com'];
    return adminEmails.includes(email);
  }

  // Get users by status
  getUsersByStatus(users: UserProfile[], status: UserProfile['status']): UserProfile[] {
    return users.filter(user => user.status === status);
  }

  // Get users by role
  getUsersByRole(users: UserProfile[], role: UserProfile['role']): UserProfile[] {
    return users.filter(user => user.role === role);
  }

  // Search users
  searchUsers(users: UserProfile[], query: string): UserProfile[] {
    const lowerQuery = query.toLowerCase();
    return users.filter(user => 
      user.email.toLowerCase().includes(lowerQuery) ||
      (user.displayName && user.displayName.toLowerCase().includes(lowerQuery))
    );
  }
}
