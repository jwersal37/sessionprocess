const { onCall } = require("firebase-functions/v2/https");
const { onValueCreated } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
const Filter = require('bad-words');
const Sentiment = require('sentiment');

// Initialize Firebase Admin
admin.initializeApp();

// Initialize content filters
const filter = new Filter();
const sentiment = new Sentiment();

// Rate limiting storage (in production, use Redis or Firestore)
const userRateLimits = new Map();

/**
 * Validates and sends a message with comprehensive server-side validation
 */
exports.sendMessage = onCall(async (request) => {
  try {
    // Authentication check
    if (!request.auth) {
      throw new Error('Authentication required');
    }

    const { text, channelId = 'general' } = request.data;
    const userId = request.auth.uid;
    const userEmail = request.auth.token.email;

    // Input validation
    if (!text || typeof text !== 'string') {
      throw new Error('Message text is required and must be a string');
    }

    if (text.trim().length === 0) {
      throw new Error('Message cannot be empty');
    }

    if (text.length > 1000) {
      throw new Error('Message too long (max 1000 characters)');
    }

    // Rate limiting check
    const rateLimitResult = checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      throw new Error(`Rate limit exceeded. Try again in ${rateLimitResult.resetTime} seconds`);
    }

    // Content validation
    const validationResult = await validateMessageContent(text, userId);
    if (!validationResult.isValid) {
      throw new Error(validationResult.reason);
    }

    // Get user profile for display name
    const userProfile = await getUserProfile(userId);
    
    // Prepare message data
    const messageData = {
      text: text.trim(),
      user: userProfile.displayName || userEmail || 'Anonymous',
      userId: userId,
      timestamp: admin.database.ServerValue.TIMESTAMP,
      channelId: channelId,
      // Add metadata for moderation
      sentiment: validationResult.sentiment,
      wordCount: text.trim().split(/\s+/).length,
      validated: true
    };

    // Save to Realtime Database
    const messagesRef = admin.database().ref('messages');
    const newMessageRef = await messagesRef.push(messageData);

    // Update rate limit
    updateRateLimit(userId);

    return {
      success: true,
      messageId: newMessageRef.key,
      message: 'Message sent successfully'
    };

  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw new Error(error.message || 'Failed to send message');
  }
});

/**
 * Automatically moderates messages as they're created
 */
exports.moderateMessage = onValueCreated('messages/{messageId}', async (event) => {
  try {
    const messageData = event.data.val();
    const messageId = event.params.messageId;

    // Skip if message was already validated by our Cloud Function
    if (messageData.validated) {
      return;
    }

    console.log(`Moderating message ${messageId}:`, messageData.text);

    // Perform content analysis
    const analysis = await analyzeContent(messageData.text);
    
    if (analysis.requiresModeration) {
      // Hide the message and add moderation flag
      await admin.database().ref(`messages/${messageId}`).update({
        hidden: true,
        moderationReason: analysis.reason,
        moderatedAt: admin.database.ServerValue.TIMESTAMP
      });

      // Log for review
      console.warn(`Message ${messageId} was hidden:`, analysis.reason);

      // Optionally notify moderators
      await notifyModerators(messageId, messageData, analysis);
    }

  } catch (error) {
    console.error('Error in moderateMessage:', error);
  }
});

/**
 * Gets user count and online status
 */
exports.getChatStats = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new Error('Authentication required');
    }

    const messagesSnapshot = await admin.database().ref('messages').limitToLast(100).once('value');
    const messages = messagesSnapshot.val() || {};
    
    const messageCount = Object.keys(messages).length;
    const uniqueUsers = new Set();
    
    Object.values(messages).forEach(msg => {
      if (msg.userId) uniqueUsers.add(msg.userId);
    });

    return {
      messageCount,
      uniqueUsers: uniqueUsers.size,
      timestamp: Date.now()
    };

  } catch (error) {
    console.error('Error in getChatStats:', error);
    throw new Error('Failed to get chat statistics');
  }
});

// Helper Functions

function checkRateLimit(userId) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 10;

  if (!userRateLimits.has(userId)) {
    userRateLimits.set(userId, { count: 1, resetTime: now + windowMs });
    return { allowed: true };
  }

  const userLimit = userRateLimits.get(userId);
  
  if (now > userLimit.resetTime) {
    // Reset the window
    userRateLimits.set(userId, { count: 1, resetTime: now + windowMs });
    return { allowed: true };
  }

  if (userLimit.count >= maxRequests) {
    return { 
      allowed: false, 
      resetTime: Math.ceil((userLimit.resetTime - now) / 1000)
    };
  }

  return { allowed: true };
}

function updateRateLimit(userId) {
  const userLimit = userRateLimits.get(userId);
  if (userLimit) {
    userLimit.count++;
  }
}

async function validateMessageContent(text, userId) {
  try {
    // Profanity filter
    if (filter.isProfane(text)) {
      return {
        isValid: false,
        reason: 'Message contains inappropriate language'
      };
    }

    // Check for spam patterns
    if (isSpamMessage(text)) {
      return {
        isValid: false,
        reason: 'Message appears to be spam'
      };
    }

    // Sentiment analysis
    const sentimentResult = sentiment.analyze(text);
    
    // Block extremely negative messages
    if (sentimentResult.score < -10) {
      return {
        isValid: false,
        reason: 'Message contains highly negative content'
      };
    }

    // Check message length and quality
    if (text.trim().length < 2) {
      return {
        isValid: false,
        reason: 'Message too short'
      };
    }

    return {
      isValid: true,
      sentiment: {
        score: sentimentResult.score,
        comparative: sentimentResult.comparative
      }
    };

  } catch (error) {
    console.error('Error validating content:', error);
    return {
      isValid: true, // Default to allowing if validation fails
      sentiment: { score: 0, comparative: 0 }
    };
  }
}

function isSpamMessage(text) {
  const spamPatterns = [
    /(.)\1{4,}/, // Repeated characters (aaaaa)
    /^[A-Z\s!]{10,}$/, // ALL CAPS
    /(http|www|\.com|\.net)/i, // URLs
    /(\d{4,})/g, // Long numbers
  ];

  return spamPatterns.some(pattern => pattern.test(text));
}

async function analyzeContent(text) {
  const issues = [];

  // Profanity check
  if (filter.isProfane(text)) {
    issues.push('Contains profanity');
  }

  // Spam check
  if (isSpamMessage(text)) {
    issues.push('Appears to be spam');
  }

  // Sentiment check
  const sentimentResult = sentiment.analyze(text);
  if (sentimentResult.score < -15) {
    issues.push('Highly negative content');
  }

  return {
    requiresModeration: issues.length > 0,
    reason: issues.join(', '),
    sentiment: sentimentResult
  };
}

async function getUserProfile(userId) {
  try {
    const userRecord = await admin.auth().getUser(userId);
    return {
      displayName: userRecord.displayName,
      email: userRecord.email
    };
  } catch (error) {
    console.error('Error getting user profile:', error);
    return { displayName: null, email: null };
  }
}

async function notifyModerators(messageId, messageData, analysis) {
  // In a real app, you might send notifications to moderators
  // For now, just log the incident
  console.log('MODERATION ALERT:', {
    messageId,
    userId: messageData.userId,
    text: messageData.text,
    reason: analysis.reason,
    timestamp: new Date().toISOString()
  });
}
