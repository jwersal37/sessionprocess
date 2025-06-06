// Basic client-side message validation utility
// This provides some protection while we don't have server-side validation

interface ValidationResult {
  isValid: boolean;
  error?: string;
}

// Basic profanity filter - simple word list
const PROFANITY_WORDS = [
  'damn', 'hell', 'crap', 'stupid', 'idiot', 'moron', 'dumb', 'hate'
  // Note: Using mild words for demonstration. In production, use a comprehensive library
];

// Spam patterns to detect
const SPAM_PATTERNS = [
  /(.)\1{4,}/i, // Repeated characters (aaaaa)
  /^[A-Z\s!]{10,}$/i, // All caps messages
  /(https?:\/\/[^\s]+)/gi, // URLs (basic detection)
  /(\b\w+\b.*){20,}/i, // Very long messages with many repeated words
];

export function validateMessage(message: string, _userId: string): ValidationResult {
  // Basic length check
  if (!message.trim()) {
    return { isValid: false, error: 'Message cannot be empty' };
  }

  if (message.length > 500) {
    return { isValid: false, error: 'Message is too long (max 500 characters)' };
  }

  // Check for profanity
  const lowerMessage = message.toLowerCase();
  for (const word of PROFANITY_WORDS) {
    if (lowerMessage.includes(word)) {
      return { isValid: false, error: 'Message contains inappropriate content' };
    }
  }

  // Check for spam patterns
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(message)) {
      return { isValid: false, error: 'Message appears to be spam' };
    }
  }

  return { isValid: true };
}

// Rate limiting - simple client-side check
const userMessageTimes = new Map<string, number[]>();

export function checkRateLimit(userId: string): ValidationResult {
  const now = Date.now();
  const timeWindow = 60000; // 1 minute
  const maxMessages = 10; // Max 10 messages per minute

  if (!userMessageTimes.has(userId)) {
    userMessageTimes.set(userId, []);
  }

  const messageTimes = userMessageTimes.get(userId)!;
  
  // Remove old timestamps
  const recentTimes = messageTimes.filter(time => now - time < timeWindow);
  
  if (recentTimes.length >= maxMessages) {
    return { isValid: false, error: 'You are sending messages too quickly. Please wait a moment.' };
  }

  // Add current timestamp
  recentTimes.push(now);
  userMessageTimes.set(userId, recentTimes);

  return { isValid: true };
}

// Clean message by removing potentially harmful content
export function sanitizeMessage(message: string): string {
  return message
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
