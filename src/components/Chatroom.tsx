import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ref, push, onValue, off, remove } from 'firebase/database';
import { database } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { validateMessage, checkRateLimit, sanitizeMessage } from '../utils/messageValidation';
import { MessageModerator } from '../utils/messageModerator';
import { UserManager } from '../utils/userManager';

interface Message {
  id: string;
  text: string;
  user: string;
  userId?: string; // Optional for backward compatibility
  timestamp: number;
}

export default function Chatroom() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { currentUser } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = ref(database, 'messages');
  const [moderator] = useState(() => new MessageModerator());
  const [userManager] = useState(() => new UserManager());

  // Initialize user profile and moderation rules on component mount
  useEffect(() => {
    if (currentUser) {
      userManager.initializeUser(
        currentUser.uid, 
        currentUser.email!, 
        currentUser.displayName || undefined
      );
    }
    moderator.initializeRules();
  }, [moderator, userManager, currentUser]);

  // Debug: Log current user status
  useEffect(() => {
    console.log('Chatroom: Current user:', currentUser ? { uid: currentUser.uid, email: currentUser.email } : 'Not authenticated');
  }, [currentUser]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    // Listen for new messages
    const unsubscribe = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const messageList = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a, b) => a.timestamp - b.timestamp);
        setMessages(messageList);
      } else {
        setMessages([]);
      }
    });    return () => off(messagesRef, 'value', unsubscribe);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim() || !currentUser) {
      console.log('Cannot send message: missing content or user not authenticated');
      return;
    }

    // Client-side validation
    const validationResult = validateMessage(newMessage, currentUser.uid);
    if (!validationResult.isValid) {
      alert(validationResult.error);
      return;
    }

    // Rate limiting check
    const rateLimitResult = checkRateLimit(currentUser.uid);
    if (!rateLimitResult.isValid) {
      alert(rateLimitResult.error);
      return;
    }

    // Advanced moderation check
    const moderationResult = moderator.moderateMessage(newMessage, currentUser.uid, '');
    
    if (moderationResult.shouldDelete) {
      alert('Your message contains content that violates our community guidelines and cannot be sent.');
      return;
    }

    try {
      setLoading(true);
      console.log('Sending message...', { user: currentUser.email, text: newMessage });
      
      // Sanitize the message before sending
      const sanitizedMessage = sanitizeMessage(newMessage);
      
      const messageData = {
        text: sanitizedMessage,
        user: currentUser.displayName || currentUser.email || 'Anonymous',
        userId: currentUser.uid,
        timestamp: Date.now()
      };

      const messageRef = await push(messagesRef, messageData);
      const messageId = messageRef.key;

      // Track user activity and increment message count
      await userManager.incrementMessageCount(currentUser.uid);
      await userManager.logActivity(currentUser.uid, 'message_sent', {
        messageId,
        messageLength: sanitizedMessage.length
      });

      // If message should be flagged but not deleted, flag it for review
      if (moderationResult.shouldFlag && messageId) {
        await moderator.flagMessage(
          {
            id: messageId,
            ...messageData
          },
          moderationResult.flagReason!,
          moderationResult.severity!,
          undefined, // No manual flagger (auto-flagged)
          true // Auto-flagged
        );
        
        // Notify user their message was flagged (optional)
        if (moderationResult.severity === 'medium' || moderationResult.severity === 'high') {
          alert('Your message has been sent but flagged for review due to potentially inappropriate content.');
        }
      }
      
      setNewMessage('');
      console.log('Message sent successfully');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please check the console for details.');
    } finally {
      setLoading(false);
    }
  };
  const handleDeleteMessage = async (messageId: string) => {
    if (!currentUser) {
      console.log('Cannot delete message: user not authenticated');
      return;
    }
    
    try {
      console.log('Deleting message...', messageId);
      const messageRef = ref(database, `messages/${messageId}`);
      await remove(messageRef);
      
      // Log user activity for message deletion
      await userManager.logActivity(currentUser.uid, 'message_deleted', {
        messageId,
        deletedBy: 'user'
      });
      
      console.log('Message deleted successfully');
    } catch (error) {
      console.error('Error deleting message:', error);
      alert('Failed to delete message. Please check the console for details.');
    }
  };
  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    // Less than 1 minute
    if (diff < 60000) {
      return 'just now';
    }
    
    // Less than 1 hour (show minutes)
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    }
    
    // Less than 24 hours (show hours)
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    
    // Less than 7 days (show days)
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days} day${days === 1 ? '' : 's'} ago`;
    }
    
    // Older than 7 days (show date)
    return new Date(timestamp).toLocaleDateString();
  };
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!newMessage.trim() || !currentUser || loading || isOverLimit) return;
    
    const syntheticEvent = {
      preventDefault: () => {},
    } as React.FormEvent;
    
    handleSendMessage(syntheticEvent);
  };
  const remainingChars = 500 - newMessage.length;
  const isOverLimit = remainingChars < 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link
                to="/dashboard"
                className="text-indigo-600 hover:text-indigo-500 font-medium"
              >
                ← Back to Dashboard
              </Link>
            </div>
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">Chatroom</h1>
            </div>
            <div className="flex items-center">
              <span className="text-sm text-gray-500">
                Welcome, {currentUser?.displayName || currentUser?.email}
              </span>
            </div>
          </div>
        </div>
      </nav>

      {/* Chat Container */}
      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {/* Messages Area */}
          <div className="h-96 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                No messages yet. Be the first to say something!
              </div>
            ) : (              messages.map((message) => {
                const isOwnMessage = message.userId 
                  ? message.userId === currentUser?.uid 
                  : message.user === (currentUser?.displayName || currentUser?.email);
                
                return (
                  <div
                    key={message.id}
                    className={`flex ${
                      isOwnMessage
                        ? 'justify-end'
                        : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg relative group ${
                        isOwnMessage
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-gray-900 shadow'
                      }`}
                    >
                      <div className="text-sm font-medium mb-1">
                        {isOwnMessage
                          ? 'You'
                          : message.user
                        }
                      </div>
                      <div className="break-words pr-6">{message.text}</div>
                      <div
                        className={`text-xs mt-1 ${
                          isOwnMessage
                            ? 'text-indigo-200'
                            : 'text-gray-500'
                        }`}
                      >
                        {formatTime(message.timestamp)}
                      </div>
                      
                      {/* Delete button - only show for user's own messages */}
                      {isOwnMessage && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteMessage(message.id);
                          }}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 rounded hover:bg-black hover:bg-opacity-20"
                          title="Delete message"
                          type="button"
                        >
                          <svg
                            className="w-4 h-4 text-current"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>          {/* Message Input */}
          <div className="p-4 bg-white border-t">
            <div className="space-y-2">
              {/* Character counter */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-500">
                  Press Enter to send, Shift+Enter for new line
                </span>
                <span className={`${isOverLimit ? 'text-red-500' : remainingChars < 100 ? 'text-yellow-500' : 'text-gray-500'}`}>
                  {remainingChars} characters remaining
                </span>
              </div>
              
              <form onSubmit={handleSendMessage} className="flex space-x-4">
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your message..."
                  className={`flex-1 border rounded-md px-3 py-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 resize-none ${
                    isOverLimit ? 'border-red-300' : 'border-gray-300'
                  }`}
                  disabled={loading}
                  rows={2}
                  maxLength={500}
                />
                <button
                  type="submit"
                  disabled={loading || !newMessage.trim() || isOverLimit}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed self-end"
                >
                  {loading ? 'Sending...' : 'Send'}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Chat Info */}
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-blue-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-700">
                This is a real-time chatroom. Messages are synced across all connected users.
                Be respectful and enjoy the conversation!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
