import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ChatAdmin } from '../utils/chatAdmin';
import { MessageModerator } from '../utils/messageModerator';
import type { FlaggedMessage } from '../utils/messageModerator';
import { UserManager } from '../utils/userManager';
import type { UserProfile, UserStats } from '../utils/userManager';
import { AnalyticsManager } from '../utils/analyticsManager';
import type { AnalyticsReport, ChatAnalytics, UserBehaviorMetrics } from '../utils/analyticsManager';

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

// Simple admin check - in production, this would be stored in user profile
const ADMIN_EMAILS = ['admin@sessionprocess.com', 'moderator@sessionprocess.com'];

export default function AdminDashboard() {
  const { currentUser, logout } = useAuth();
  const [stats, setStats] = useState<ChatStats | null>(null);
  const [chatAdmin] = useState(() => new ChatAdmin());
  const [moderator] = useState(() => new MessageModerator());  const [userManager] = useState(() => new UserManager());
  const [analyticsManager] = useState(() => new AnalyticsManager());
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filteredMessages, setFilteredMessages] = useState<Message[]>([]);
  const [flaggedMessages, setFlaggedMessages] = useState<FlaggedMessage[]>([]);  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [analyticsData, setAnalyticsData] = useState<ChatAnalytics | null>(null);
  const [analyticsReports, setAnalyticsReports] = useState<AnalyticsReport[]>([]);
  const [selectedAnalyticsTab, setSelectedAnalyticsTab] = useState<'overview' | 'behavior' | 'reports'>('overview');
  const [userBehaviorMetrics, setUserBehaviorMetrics] = useState<UserBehaviorMetrics[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');  const [selectedUserFilter, setSelectedUserFilter] = useState<'all' | 'active' | 'banned' | 'suspended'>('all');
  const [selectedTab, setSelectedTab] = useState<'overview' | 'messages' | 'users' | 'moderation' | 'analytics'>('overview');

  // Check if current user is admin
  const isAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email || '');
  useEffect(() => {
    if (!isAdmin) return;

    // Start monitoring chat
    chatAdmin.startMonitoring((newStats) => {
      setStats(newStats);
    });

    // Start monitoring flagged messages
    const unsubscribeFlagged = moderator.monitorFlaggedMessages((flagged) => {
      setFlaggedMessages(flagged);
    });

    // Start monitoring users
    const unsubscribeUsers = userManager.monitorUsers((users) => {
      setUsers(users);
    });

    // Load user statistics
    userManager.getUserStats().then(setUserStats);

    return () => {
      chatAdmin.stopMonitoring();
      unsubscribeFlagged();
      unsubscribeUsers();
    };
  }, [isAdmin, chatAdmin, moderator, userManager]);

  useEffect(() => {
    if (filterKeyword.trim()) {
      const filtered = chatAdmin.getMessagesWithKeywords([filterKeyword]);
      setFilteredMessages(filtered);
    } else {
      setFilteredMessages([]);
    }
  }, [filterKeyword, chatAdmin, stats]); // Re-filter when stats update (new messages)
  const handleDeleteMessage = async (messageId: string) => {
    if (window.confirm('Are you sure you want to delete this message?')) {
      const success = await chatAdmin.deleteMessage(messageId);
      if (success) {
        // Log admin activity for direct message deletion
        if (currentUser) {
          await userManager.logActivity(currentUser.uid, 'message_deleted', {
            messageId,
            deletedBy: 'admin',
            directDeletion: true
          });
        }
        alert('Message deleted successfully');
      } else {
        alert('Failed to delete message');
      }
    }
  };
  const handleExportChat = () => {
    const exportData = chatAdmin.exportChatHistory();
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const handleReviewFlaggedMessage = async (
    messageId: string, 
    action: 'approved' | 'deleted' | 'edited'
  ) => {
    if (!currentUser) return;
    
    const success = await moderator.reviewFlaggedMessage(messageId, currentUser.uid, action);
    if (success) {
      // Log admin activity for message review/deletion
      if (action === 'deleted') {
        await userManager.logActivity(currentUser.uid, 'message_deleted', {
          messageId,
          deletedBy: 'admin',
          moderatorAction: true,
          reviewAction: action
        });
      }
      alert(`Message ${action} successfully`);
    } else {
      alert(`Failed to ${action} message`);
    }
  };

  const handleManualFlag = async (messageId: string, reason: FlaggedMessage['flagReason']) => {
    if (!currentUser) return;

    const message = chatAdmin.getMessages().find(msg => msg.id === messageId);
    if (!message) return;

    const success = await moderator.flagMessage(
      message,
      reason,
      'medium', // Manual flags default to medium severity
      currentUser.uid,
      false // Not auto-flagged
    );
    
    if (success) {
      alert('Message flagged successfully');
    } else {
      alert('Failed to flag message');
    }
  };

  // User management handlers
  const handleBanUser = async (userId: string, reason: string, type: 'temporary' | 'permanent', duration?: number) => {
    if (!currentUser) return;
    
    if (window.confirm(`Are you sure you want to ${type === 'permanent' ? 'permanently ban' : `temporarily ban for ${duration} hours`} this user?`)) {
      const success = await userManager.banUser(userId, currentUser.uid, reason, type, duration);
      if (success) {
        alert('User banned successfully');
        // Refresh user stats
        userManager.getUserStats().then(setUserStats);
      } else {
        alert('Failed to ban user');
      }
    }
  };

  const handleUnbanUser = async (userId: string, reason: string) => {
    if (!currentUser) return;
    
    if (window.confirm('Are you sure you want to unban this user?')) {
      const success = await userManager.unbanUser(userId, currentUser.uid, reason);
      if (success) {
        alert('User unbanned successfully');
        userManager.getUserStats().then(setUserStats);
      } else {
        alert('Failed to unban user');
      }
    }
  };

  const handleSuspendUser = async (userId: string, reason: string, hours: number) => {
    if (!currentUser) return;
    
    if (window.confirm(`Are you sure you want to suspend this user for ${hours} hours?`)) {
      const success = await userManager.suspendUser(userId, currentUser.uid, reason, hours);
      if (success) {
        alert('User suspended successfully');
        userManager.getUserStats().then(setUserStats);
      } else {
        alert('Failed to suspend user');
      }
    }
  };

  const handleWarnUser = async (userId: string, reason: string) => {
    if (!currentUser) return;
    
    const success = await userManager.warnUser(userId, currentUser.uid, reason);
    if (success) {
      alert('Warning issued successfully');
      userManager.getUserStats().then(setUserStats);
    } else {
      alert('Failed to issue warning');
    }
  };

  const handleUpdateUserRole = async (userId: string, newRole: UserProfile['role']) => {
    if (!currentUser) return;
    
    if (window.confirm(`Are you sure you want to change this user's role to ${newRole}?`)) {
      const success = await userManager.updateUserRole(userId, newRole, currentUser.uid);
      if (success) {
        alert('User role updated successfully');
        userManager.getUserStats().then(setUserStats);
      } else {
        alert('Failed to update user role');
      }
    }
  };

  // Filter users based on search and status
  const filteredUsers = users.filter(user => {
    const matchesSearch = userSearchQuery === '' || 
      user.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      (user.displayName && user.displayName.toLowerCase().includes(userSearchQuery.toLowerCase()));
    
    const matchesFilter = selectedUserFilter === 'all' || user.status === selectedUserFilter;
    
    return matchesSearch && matchesFilter;
  });

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h1>
          <p className="text-gray-600 mb-4">Please log in to access the admin dashboard.</p>
          <Link to="/login" className="text-indigo-600 hover:text-indigo-500">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Admin Access Required</h1>
          <p className="text-gray-600 mb-4">You don't have permission to access the admin dashboard.</p>
          <Link to="/dashboard" className="text-indigo-600 hover:text-indigo-500">
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/dashboard" className="text-xl font-bold text-gray-900">
                Admin Dashboard
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                Welcome, {currentUser?.email}
              </span>
              <Link 
                to="/chatroom" 
                className="text-indigo-600 hover:text-indigo-500"
              >
                Chat
              </Link>
              <Link 
                to="/dashboard" 
                className="text-indigo-600 hover:text-indigo-500"
              >
                Dashboard
              </Link>
              <button
                onClick={() => logout()}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>      </nav>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {['overview', 'messages', 'moderation', 'users', 'analytics'].map((tab) => (
              <button
                key={tab}
                onClick={() => setSelectedTab(tab as typeof selectedTab)}
                className={`py-2 px-1 border-b-2 font-medium text-sm capitalize ${
                  selectedTab === tab
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab === 'moderation' ? (
                  <span className="flex items-center">
                    Moderation
                    {flaggedMessages.filter(msg => !msg.reviewed).length > 0 && (
                      <span className="ml-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                        {flaggedMessages.filter(msg => !msg.reviewed).length}
                      </span>
                    )}
                  </span>
                ) : (
                  tab
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {selectedTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Cards */}
            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-indigo-500 rounded-md flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">M</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">
                            Total Messages
                          </dt>
                          <dd className="text-lg font-medium text-gray-900">
                            {stats.totalMessages}
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">U</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">
                            Active Users
                          </dt>
                          <dd className="text-lg font-medium text-gray-900">
                            {stats.activeUsers.size}
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">H</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">
                            Messages/Hour
                          </dt>
                          <dd className="text-lg font-medium text-gray-900">
                            {stats.messagesPerHour}
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <button
                          onClick={handleExportChat}
                          className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center hover:bg-blue-600 transition-colors"
                        >
                          <span className="text-white font-semibold text-sm">↓</span>
                        </button>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">
                            Export Chat
                          </dt>
                          <dd className="text-sm font-medium text-blue-600">
                            Download JSON
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Top Users */}
            {stats && stats.topUsers.length > 0 && (
              <div className="bg-white shadow overflow-hidden sm:rounded-md">
                <div className="px-4 py-5 sm:px-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Most Active Users
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm text-gray-500">
                    Users with the most messages sent
                  </p>
                </div>
                <ul className="divide-y divide-gray-200">
                  {stats.topUsers.slice(0, 5).map((userStat, index) => (
                    <li key={userStat.user} className="px-4 py-4 flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-8 w-8">
                          <div className="h-8 w-8 rounded-full bg-gray-300 flex items-center justify-center">
                            <span className="text-sm font-medium text-gray-700">
                              #{index + 1}
                            </span>
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {userStat.user}
                          </div>
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {userStat.count} messages
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Messages Tab */}
        {selectedTab === 'messages' && (
          <div className="space-y-6">
            {/* Search Bar */}
            <div className="bg-white shadow sm:rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Message Search & Moderation
                </h3>
                <div className="flex space-x-4">
                  <input
                    type="text"
                    value={filterKeyword}
                    onChange={(e) => setFilterKeyword(e.target.value)}
                    placeholder="Search messages by keyword..."
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  <button
                    onClick={() => setFilterKeyword('')}
                    className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-md font-medium"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Filtered Messages */}
            {filteredMessages.length > 0 && (
              <div className="bg-white shadow overflow-hidden sm:rounded-md">
                <div className="px-4 py-5 sm:px-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Search Results ({filteredMessages.length} messages)
                  </h3>
                </div>
                <ul className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                  {filteredMessages.map((message) => (
                    <li key={message.id} className="px-4 py-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-gray-900">
                              {message.user}
                            </div>
                            <div className="text-xs text-gray-500">
                              {formatTime(message.timestamp)}
                            </div>
                          </div>
                          <div className="mt-1 text-sm text-gray-600 break-words">
                            {message.text}
                          </div>                        </div>
                        <div className="ml-4 flex flex-col space-y-1">
                          <button
                            onClick={() => handleManualFlag(message.id, 'inappropriate')}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-xs font-medium"
                          >
                            Flag
                          </button>
                          <button
                            onClick={() => handleDeleteMessage(message.id)}
                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {filterKeyword && filteredMessages.length === 0 && (
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:p-6 text-center">
                  <div className="text-gray-500">
                    No messages found matching "{filterKeyword}"
                  </div>
                </div>
              </div>
            )}
          </div>        )}

        {/* Moderation Tab */}
        {selectedTab === 'moderation' && (
          <div className="space-y-6">
            {/* Moderation Statistics */}
            {flaggedMessages.length > 0 && (
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:px-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Moderation Statistics
                  </h3>
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {(() => {
                      const stats = moderator.getFlaggedMessagesStats(flaggedMessages);
                      return (
                        <>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-red-600">{stats.unreviewed}</div>
                            <div className="text-sm text-gray-500">Pending Review</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-yellow-600">{stats.bySeverity.high}</div>
                            <div className="text-sm text-gray-500">High Severity</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-orange-600">{stats.bySeverity.medium}</div>
                            <div className="text-sm text-gray-500">Medium Severity</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-green-600">{stats.autoFlagged}</div>
                            <div className="text-sm text-gray-500">Auto-Flagged</div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Flagged Messages */}
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <div className="px-4 py-5 sm:px-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Flagged Messages ({flaggedMessages.filter(msg => !msg.reviewed).length} pending)
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">
                  Messages that have been flagged for review
                </p>
              </div>
              
              {flaggedMessages.filter(msg => !msg.reviewed).length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-500">
                  No flagged messages pending review
                </div>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {flaggedMessages
                    .filter(msg => !msg.reviewed)
                    .sort((a, b) => {
                      // Sort by severity (high -> medium -> low) then by timestamp
                      const severityOrder = { high: 3, medium: 2, low: 1 };
                      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
                        return severityOrder[b.severity] - severityOrder[a.severity];
                      }
                      return b.flaggedAt - a.flaggedAt;
                    })
                    .map((flaggedMsg) => (
                      <li key={flaggedMsg.id} className="px-4 py-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            {/* Message Info */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-3">
                                <span className="text-sm font-medium text-gray-900">
                                  {flaggedMsg.user}
                                </span>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  flaggedMsg.severity === 'high' 
                                    ? 'bg-red-100 text-red-800'
                                    : flaggedMsg.severity === 'medium'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-green-100 text-green-800'
                                }`}>
                                  {flaggedMsg.severity} severity
                                </span>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  flaggedMsg.flagReason === 'profanity' 
                                    ? 'bg-purple-100 text-purple-800'
                                    : flaggedMsg.flagReason === 'harassment'
                                    ? 'bg-red-100 text-red-800'
                                    : flaggedMsg.flagReason === 'spam'
                                    ? 'bg-orange-100 text-orange-800'
                                    : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {flaggedMsg.flagReason}
                                </span>
                                {flaggedMsg.autoFlagged && (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                    Auto-flagged
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-gray-500">
                                {formatTime(flaggedMsg.flaggedAt)}
                              </span>
                            </div>
                            
                            {/* Message Content */}
                            <div className="bg-gray-50 rounded-md p-3 mb-3">
                              <p className="text-sm text-gray-900 break-words">
                                "{flaggedMsg.text}"
                              </p>
                            </div>
                            
                            {/* Original Message Time */}
                            <div className="text-xs text-gray-500">
                              Originally sent: {formatTime(flaggedMsg.timestamp)}
                            </div>
                          </div>
                          
                          {/* Action Buttons */}
                          <div className="ml-6 flex flex-col space-y-2">
                            <button
                              onClick={() => handleReviewFlaggedMessage(flaggedMsg.id, 'approved')}
                              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-medium"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleReviewFlaggedMessage(flaggedMsg.id, 'deleted')}
                              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-medium"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {/* Recently Reviewed Messages */}
            {flaggedMessages.filter(msg => msg.reviewed).length > 0 && (
              <div className="bg-white shadow overflow-hidden sm:rounded-md">
                <div className="px-4 py-5 sm:px-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Recently Reviewed ({flaggedMessages.filter(msg => msg.reviewed).length})
                  </h3>
                </div>
                <ul className="divide-y divide-gray-200 max-h-64 overflow-y-auto">
                  {flaggedMessages
                    .filter(msg => msg.reviewed)
                    .sort((a, b) => (b.reviewedAt || 0) - (a.reviewedAt || 0))
                    .slice(0, 10)
                    .map((flaggedMsg) => (
                      <li key={flaggedMsg.id} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-900 truncate">
                              "{flaggedMsg.text}"
                            </div>
                            <div className="text-xs text-gray-500">
                              {flaggedMsg.user} • {flaggedMsg.flagReason} • {formatTime(flaggedMsg.reviewedAt || 0)}
                            </div>
                          </div>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            flaggedMsg.action === 'approved' 
                              ? 'bg-green-100 text-green-800'
                              : flaggedMsg.action === 'deleted'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {flaggedMsg.action}
                          </span>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}        {/* Users Tab */}
        {selectedTab === 'users' && (
          <div className="space-y-6">
            {/* User Statistics */}
            {userStats && (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">U</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">Total Users</dt>
                          <dd className="text-lg font-medium text-gray-900">{userStats.totalUsers}</dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">A</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">Active Users</dt>
                          <dd className="text-lg font-medium text-gray-900">{userStats.activeUsers}</dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-red-500 rounded-md flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">B</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">Banned Users</dt>
                          <dd className="text-lg font-medium text-gray-900">{userStats.bannedUsers}</dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">S</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">Suspended</dt>
                          <dd className="text-lg font-medium text-gray-900">{userStats.suspendedUsers}</dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-purple-500 rounded-md flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">N</span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">New Today</dt>
                          <dd className="text-lg font-medium text-gray-900">{userStats.newUsersToday}</dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Search and Filter */}
            <div className="bg-white shadow sm:rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">User Search & Management</h3>
                <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder="Search by email or display name..."
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />                  <select
                    value={selectedUserFilter}
                    onChange={(e) => setSelectedUserFilter(e.target.value as any)}
                    title="Filter users by status"
                    className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="all">All Users</option>
                    <option value="active">Active</option>
                    <option value="banned">Banned</option>
                    <option value="suspended">Suspended</option>
                  </select>
                  <button
                    onClick={() => {
                      setUserSearchQuery('');
                      setSelectedUserFilter('all');
                    }}
                    className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-md font-medium"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Users List */}
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <div className="px-4 py-5 sm:px-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Users ({filteredUsers.length})
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">
                  Manage user accounts, roles, and permissions
                </p>
              </div>

              {filteredUsers.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-500">
                  No users found matching your criteria
                </div>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {filteredUsers.map((user) => (
                    <li key={user.uid} className="px-4 py-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          {/* User Info */}
                          <div className="flex items-center space-x-3 mb-2">
                            <div className="flex-shrink-0 h-10 w-10">
                              <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                                <span className="text-sm font-medium text-gray-700">
                                  {user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase()}
                                </span>
                              </div>
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                <span className="text-sm font-medium text-gray-900">
                                  {user.displayName || 'No display name'}
                                </span>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  user.role === 'admin' 
                                    ? 'bg-purple-100 text-purple-800'
                                    : user.role === 'moderator'
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {user.role}
                                </span>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  user.status === 'active' 
                                    ? 'bg-green-100 text-green-800'
                                    : user.status === 'banned'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {user.status}
                                </span>
                              </div>
                              <div className="text-sm text-gray-500">{user.email}</div>
                            </div>
                          </div>

                          {/* User Stats */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3 bg-gray-50 rounded-md p-3">
                            <div className="text-center">
                              <div className="text-lg font-semibold text-gray-900">{user.messageCount}</div>
                              <div className="text-xs text-gray-500">Messages</div>
                            </div>
                            <div className="text-center">
                              <div className="text-lg font-semibold text-gray-900">{user.flagCount}</div>
                              <div className="text-xs text-gray-500">Flags</div>
                            </div>
                            <div className="text-center">
                              <div className="text-lg font-semibold text-gray-900">{user.warningCount}</div>
                              <div className="text-xs text-gray-500">Warnings</div>
                            </div>
                            <div className="text-center">
                              <div className="text-sm text-gray-600">{formatTime(user.lastActive)}</div>
                              <div className="text-xs text-gray-500">Last Active</div>
                            </div>
                          </div>

                          {/* Ban History */}
                          {user.banHistory.length > 0 && (
                            <div className="mb-3">
                              <div className="text-xs font-medium text-gray-500 mb-1">
                                Ban History ({user.banHistory.length})
                              </div>
                              <div className="text-xs text-gray-600">
                                {user.banHistory.filter(ban => ban.isActive).length > 0 
                                  ? 'Currently banned' 
                                  : `Last ban: ${formatTime(Math.max(...user.banHistory.map(ban => ban.startDate)))}`
                                }
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="ml-6 flex flex-col space-y-2">
                          {/* Role Management */}
                          <div className="flex space-x-2">
                            {user.role !== 'admin' && (
                              <button
                                onClick={() => handleUpdateUserRole(user.uid, 'admin')}
                                className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded text-xs font-medium"
                              >
                                Make Admin
                              </button>
                            )}
                            {user.role !== 'moderator' && (
                              <button
                                onClick={() => handleUpdateUserRole(user.uid, 'moderator')}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-medium"
                              >
                                Make Mod
                              </button>
                            )}
                            {user.role !== 'user' && (
                              <button
                                onClick={() => handleUpdateUserRole(user.uid, 'user')}
                                className="bg-gray-600 hover:bg-gray-700 text-white px-2 py-1 rounded text-xs font-medium"
                              >
                                Make User
                              </button>
                            )}
                          </div>

                          {/* Moderation Actions */}
                          <div className="flex space-x-2">
                            <button
                              onClick={() => {
                                const reason = prompt('Warning reason:');
                                if (reason) handleWarnUser(user.uid, reason);
                              }}
                              className="bg-yellow-600 hover:bg-yellow-700 text-white px-2 py-1 rounded text-xs font-medium"
                            >
                              Warn
                            </button>
                            <button
                              onClick={() => {
                                const reason = prompt('Suspension reason:');
                                const hours = prompt('Hours to suspend:');
                                if (reason && hours) handleSuspendUser(user.uid, reason, parseInt(hours));
                              }}
                              className="bg-orange-600 hover:bg-orange-700 text-white px-2 py-1 rounded text-xs font-medium"
                            >
                              Suspend
                            </button>
                          </div>

                          {/* Ban/Unban Actions */}
                          <div className="flex space-x-2">
                            {user.status !== 'banned' ? (
                              <>
                                <button
                                  onClick={() => {
                                    const reason = prompt('Ban reason:');
                                    const hours = prompt('Hours to ban (leave empty for permanent):');
                                    if (reason) {
                                      const duration = hours ? parseInt(hours) : undefined;
                                      handleBanUser(user.uid, reason, duration ? 'temporary' : 'permanent', duration);
                                    }
                                  }}
                                  className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs font-medium"
                                >
                                  Ban
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => {
                                  const reason = prompt('Unban reason:') || 'Admin discretion';
                                  handleUnbanUser(user.uid, reason);
                                }}
                                className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs font-medium"
                              >
                                Unban
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent User Activity */}
            {userStats && userStats.recentActivity.length > 0 && (
              <div className="bg-white shadow overflow-hidden sm:rounded-md">
                <div className="px-4 py-5 sm:px-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Recent User Activity
                  </h3>
                </div>
                <ul className="divide-y divide-gray-200 max-h-64 overflow-y-auto">
                  {userStats.recentActivity.slice(0, 20).map((activity, index) => (
                    <li key={index} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            activity.action === 'login' 
                              ? 'bg-green-100 text-green-800'
                              : activity.action === 'logout'
                              ? 'bg-gray-100 text-gray-800'
                              : activity.action === 'message_sent'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {activity.action.replace('_', ' ')}
                          </span>
                          <span className="text-sm text-gray-900">
                            User: {activity.userId}
                          </span>
                          {activity.details && (
                            <span className="text-xs text-gray-500">
                              {JSON.stringify(activity.details)}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">
                          {formatTime(activity.timestamp)}
                        </span>
                      </div>
                    </li>                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Analytics Tab */}
        {selectedTab === 'analytics' && (
          <div className="space-y-6">
            {/* Analytics Navigation */}
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                {(['overview', 'behavior', 'reports'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setSelectedAnalyticsTab(tab)}
                    className={`py-2 px-1 border-b-2 font-medium text-sm capitalize ${
                      selectedAnalyticsTab === tab
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </nav>
            </div>

            {/* Analytics Overview */}
            {selectedAnalyticsTab === 'overview' && (
              <div className="space-y-6">
                {/* Quick Actions */}
                <div className="bg-white shadow sm:rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                      Analytics Actions
                    </h3>
                    <div className="flex flex-wrap gap-4">
                      <button
                        onClick={async () => {
                          try {
                            const analytics = await analyticsManager.generateChatAnalytics();
                            setAnalyticsData(analytics);
                            alert('Analytics generated successfully!');
                          } catch (error) {
                            console.error('Analytics generation failed:', error);
                            alert('Failed to generate analytics');
                          }
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium"
                      >
                        Generate Chat Analytics
                      </button>                      <button
                        onClick={async () => {
                          try {
                            // For demo purposes, analyze behavior for all users
                            const allUsers = users.slice(0, 10); // Limit to first 10 users
                            const behaviorPromises = allUsers.map(user => 
                              analyticsManager.analyzeUserBehavior(user.uid)
                            );
                            const behaviors = await Promise.all(behaviorPromises);
                            const validBehaviors = behaviors.filter(b => b !== null) as UserBehaviorMetrics[];
                            setUserBehaviorMetrics(validBehaviors);
                            alert(`User behavior analysis completed for ${validBehaviors.length} users!`);
                          } catch (error) {
                            console.error('User behavior analysis failed:', error);
                            alert('Failed to analyze user behavior');
                          }
                        }}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md font-medium"
                      >
                        Analyze User Behavior
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const report = await analyticsManager.generateReport('daily', undefined, undefined, currentUser?.uid || 'admin');
                            setAnalyticsReports(prev => [report, ...prev]);
                            alert('Analytics report generated!');
                          } catch (error) {
                            console.error('Report generation failed:', error);
                            alert('Failed to generate report');
                          }
                        }}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md font-medium"
                      >
                        Generate Report
                      </button>
                    </div>
                  </div>
                </div>                {/* Analytics Summary Cards */}
                {analyticsData && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white overflow-hidden shadow rounded-lg">
                      <div className="p-5">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                              <span className="text-white font-semibold text-sm">M</span>
                            </div>
                          </div>
                          <div className="ml-5 w-0 flex-1">
                            <dl>
                              <dt className="text-sm font-medium text-gray-500 truncate">
                                Total Messages
                              </dt>
                              <dd className="text-lg font-medium text-gray-900">
                                {analyticsData.totalMessages}
                              </dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                      <div className="p-5">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                              <span className="text-white font-semibold text-sm">U</span>
                            </div>
                          </div>
                          <div className="ml-5 w-0 flex-1">
                            <dl>
                              <dt className="text-sm font-medium text-gray-500 truncate">
                                Active Users 24h
                              </dt>
                              <dd className="text-lg font-medium text-gray-900">
                                {analyticsData.activeUsers24h}
                              </dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                      <div className="p-5">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-red-500 rounded-md flex items-center justify-center">
                              <span className="text-white font-semibold text-sm">F</span>
                            </div>
                          </div>
                          <div className="ml-5 w-0 flex-1">
                            <dl>
                              <dt className="text-sm font-medium text-gray-500 truncate">
                                Flagged Messages
                              </dt>
                              <dd className="text-lg font-medium text-gray-900">
                                {analyticsData.moderationStats.totalFlagged}
                              </dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                      <div className="p-5">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                              <span className="text-white font-semibold text-sm">R</span>
                            </div>
                          </div>
                          <div className="ml-5 w-0 flex-1">
                            <dl>
                              <dt className="text-sm font-medium text-gray-500 truncate">
                                Flag Ratio
                              </dt>
                              <dd className="text-lg font-medium text-gray-900">
                                {(analyticsData.moderationStats.flaggedRatio * 100).toFixed(1)}%
                              </dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Top Keywords */}
                {analyticsData && analyticsData.wordCloud.length > 0 && (
                  <div className="bg-white shadow overflow-hidden sm:rounded-md">
                    <div className="px-4 py-5 sm:px-6">
                      <h3 className="text-lg leading-6 font-medium text-gray-900">
                        Top Keywords
                      </h3>
                    </div>
                    <ul className="divide-y divide-gray-200">
                      {analyticsData.wordCloud.slice(0, 10).map((keyword: { word: string; frequency: number }, index: number) => (
                        <li key={keyword.word} className="px-4 py-4 flex items-center justify-between">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8">
                              <div className="h-8 w-8 rounded-full bg-gray-300 flex items-center justify-center">
                                <span className="text-sm font-medium text-gray-700">
                                  #{index + 1}
                                </span>
                              </div>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">
                                {keyword.word}
                              </div>
                            </div>
                          </div>
                          <div className="text-sm text-gray-500">
                            {keyword.frequency} times
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* User Behavior Analytics */}
            {selectedAnalyticsTab === 'behavior' && (
              <div className="space-y-6">
                {userBehaviorMetrics.length > 0 ? (
                  <div className="bg-white shadow overflow-hidden sm:rounded-md">
                    <div className="px-4 py-5 sm:px-6">
                      <h3 className="text-lg leading-6 font-medium text-gray-900">
                        User Behavior Analysis ({userBehaviorMetrics.length} users)
                      </h3>
                    </div>
                    <ul className="divide-y divide-gray-200">
                      {userBehaviorMetrics
                        .sort((a, b) => b.riskScore - a.riskScore)
                        .slice(0, 20)
                        .map((metrics) => (
                          <li key={metrics.userId} className="px-4 py-6">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center space-x-3 mb-2">
                                  <span className="text-sm font-medium text-gray-900">
                                    {metrics.userId}
                                  </span>
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    metrics.riskScore >= 7 
                                      ? 'bg-red-100 text-red-800'
                                      : metrics.riskScore >= 4
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-green-100 text-green-800'
                                  }`}>
                                    Risk: {metrics.riskScore.toFixed(1)}
                                  </span>
                                </div>
                                
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 rounded-md p-3">                                  <div className="text-center">
                                    <div className="text-lg font-semibold text-gray-900">
                                      {metrics.averageMessageLength.toFixed(0)}
                                    </div>
                                    <div className="text-xs text-gray-500">Avg Length</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-lg font-semibold text-gray-900">
                                      {metrics.messagesPerHour.toFixed(1)}
                                    </div>
                                    <div className="text-xs text-gray-500">Msgs/Hour</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-lg font-semibold text-gray-900">
                                      {(metrics.sentimentTrend.reduce((sum, item) => sum + item.avgSentiment, 0) / (metrics.sentimentTrend.length || 1)).toFixed(2)}
                                    </div>
                                    <div className="text-xs text-gray-500">Avg Sentiment</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-lg font-semibold text-gray-900">
                                      {metrics.topKeywords.length}
                                    </div>
                                    <div className="text-xs text-gray-500">Keywords</div>
                                  </div>
                                </div>

                                {metrics.topKeywords.length > 0 && (
                                  <div className="mt-3">
                                    <div className="text-xs font-medium text-gray-500 mb-1">
                                      Top Keywords:
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {metrics.topKeywords.slice(0, 5).map((keyword: { word: string; count: number }, index: number) => (
                                        <span
                                          key={index}
                                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                                        >
                                          {keyword.word} ({keyword.count})
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : (
                  <div className="bg-white shadow sm:rounded-lg">
                    <div className="px-4 py-5 sm:p-6 text-center">
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        No User Behavior Data
                      </h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Click "Analyze User Behavior" to generate user behavior metrics.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Analytics Reports */}
            {selectedAnalyticsTab === 'reports' && (
              <div className="space-y-6">
                {analyticsReports.length > 0 ? (
                  <div className="space-y-6">
                    {analyticsReports.map((report, index) => (
                      <div key={report.id} className="bg-white shadow overflow-hidden sm:rounded-lg">
                        <div className="px-4 py-5 sm:px-6">
                          <div className="flex items-center justify-between">                            <div>
                              <h3 className="text-lg leading-6 font-medium text-gray-900">
                                Analytics Report #{analyticsReports.length - index}
                              </h3>
                              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                                Generated on {new Date(report.generatedAt).toLocaleString()}
                              </p>
                            </div>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {report.type} report
                            </span>
                          </div>
                        </div>
                        
                        <div className="border-t border-gray-200 px-4 py-5 sm:p-6">
                          {/* Key Insights */}
                          <div className="mb-6">
                            <h4 className="text-md font-medium text-gray-900 mb-3">Key Insights</h4>
                            <ul className="space-y-2">
                              {report.insights.map((insight, idx) => (
                                <li key={idx} className="flex items-start">
                                  <div className="flex-shrink-0 h-5 w-5 mt-0.5">
                                    <div className="h-2 w-2 bg-blue-500 rounded-full mt-1.5"></div>
                                  </div>
                                  <span className="ml-3 text-sm text-gray-700">{insight}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Recommendations */}
                          <div className="mb-6">
                            <h4 className="text-md font-medium text-gray-900 mb-3">Recommendations</h4>
                            <ul className="space-y-2">
                              {report.recommendations.map((recommendation, idx) => (
                                <li key={idx} className="flex items-start">
                                  <div className="flex-shrink-0 h-5 w-5 mt-0.5">
                                    <div className="h-2 w-2 bg-green-500 rounded-full mt-1.5"></div>
                                  </div>
                                  <span className="ml-3 text-sm text-gray-700">{recommendation}</span>
                                </li>
                              ))}
                            </ul>
                          </div>                          {/* Report Metrics Summary */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 rounded-lg p-4">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-gray-900">
                                {report.chatAnalytics.totalMessages}
                              </div>
                              <div className="text-sm text-gray-500">Total Messages</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-gray-900">
                                {report.chatAnalytics.activeUsers24h}
                              </div>
                              <div className="text-sm text-gray-500">Active Users 24h</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-gray-900">
                                {(report.chatAnalytics.moderationStats.flaggedRatio * 100).toFixed(1)}%
                              </div>
                              <div className="text-sm text-gray-500">Flag Ratio</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white shadow sm:rounded-lg">
                    <div className="px-4 py-5 sm:p-6 text-center">
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        No Analytics Reports
                      </h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Click "Generate Report" to create your first analytics report.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
