# SessionProcess - React Chat Application

A full-featured real-time chat application built with React, TypeScript, and Firebase, deployed on GitHub Pages.

## 🚀 Live Demo

**URL:** https://jwersal37.github.io/sessionprocess/

## 📋 Features

### Authentication
- ✅ User registration and login with Firebase Auth
- ✅ Secure password-based authentication
- ✅ Automatic login persistence
- ✅ Protected routes for authenticated users
- ✅ Auto-redirect after successful login/signup

### Real-time Chat
- ✅ Real-time messaging using Firebase Realtime Database
- ✅ Message timestamps with smart formatting (just now, 5 minutes ago, etc.)
- ✅ User identification for each message
- ✅ Message deletion (users can delete their own messages)
- ✅ Smooth auto-scroll to latest messages

### User Experience
- ✅ Modern, responsive UI built with Tailwind CSS
- ✅ Enter key to send messages (Shift+Enter for new line)
- ✅ Character counter with visual feedback
- ✅ Loading states and error handling
- ✅ Mobile-friendly design

### Message Validation & Security
- ✅ Client-side message validation with profanity filtering
- ✅ Rate limiting to prevent spam (10 messages per minute)
- ✅ Character limit enforcement (500 characters)
- ✅ Message sanitization to prevent XSS attacks
- ✅ Firebase security rules for server-side validation

### GitHub Pages Deployment
- ✅ Automated deployment via GitHub Actions
- ✅ Hash-based routing for SPA compatibility
- ✅ Environment variable management via GitHub Secrets
- ✅ Optimized build process with Vite

## 🛠️ Technology Stack

- **Frontend:** React 18 + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS v4
- **Routing:** React Router v6 (HashRouter for GitHub Pages)
- **Backend:** Firebase (Authentication + Realtime Database)
- **Deployment:** GitHub Pages + GitHub Actions
- **Functions:** Firebase Cloud Functions (prepared but requires Blaze plan)

## 🏗️ Architecture

### Components Structure
```
src/
├── components/
│   ├── Login.tsx           # Authentication form
│   ├── Signup.tsx          # User registration
│   ├── Dashboard.tsx       # User dashboard
│   ├── Chatroom.tsx        # Main chat interface
│   └── PrivateRoute.tsx    # Route protection
├── contexts/
│   └── AuthContext.tsx     # Authentication state management
├── utils/
│   ├── messageValidation.ts # Client-side validation
│   └── chatAdmin.ts        # Admin utilities
└── firebase.ts             # Firebase configuration
```

### Firebase Configuration
- **Authentication:** Email/password authentication
- **Realtime Database:** Message storage with security rules
- **Security Rules:** Server-side validation for message integrity
- **Cloud Functions:** Prepared for advanced moderation (requires upgrade)

## 🔒 Security Features

### Client-Side Validation
- Message length limits (1-500 characters)
- Basic profanity filtering
- Spam pattern detection
- Rate limiting (10 messages/minute)
- XSS prevention through sanitization

### Server-Side Security
- Firebase security rules enforce:
  - User authentication for all operations
  - Message structure validation
  - User ownership verification for deletions
  - Character limits and non-empty messages

### Firebase Security Rules
```javascript
{
  "rules": {
    "messages": {
      ".read": "auth != null",
      ".write": "auth != null",
      "$messageId": {
        ".validate": "newData.hasChildren(['text', 'user', 'userId', 'timestamp']) && newData.child('text').isString() && newData.child('text').val().length <= 500 && newData.child('text').val().length > 0 && newData.child('userId').val() == auth.uid",
        ".write": "!data.exists() || data.child('userId').val() == auth.uid"
      }
    }
  }
}
```

## 🚀 Deployment

### Automatic Deployment
- Pushes to `main` branch trigger automatic deployment
- GitHub Actions workflow builds and deploys to GitHub Pages
- Environment variables managed via GitHub Secrets

### Manual Deployment
```bash
npm run build
# Files are built to dist/ directory
# GitHub Actions handles deployment automatically
```

## 🔧 Local Development

### Prerequisites
- Node.js 18+
- Firebase project with Authentication and Realtime Database
- Environment variables configured

### Setup
```bash
# Clone repository
git clone https://github.com/jwersal37/sessionprocess.git
cd sessionprocess

# Install dependencies
npm install

# Configure environment variables
# Create .env file with Firebase configuration

# Start development server
npm run dev
```

### Environment Variables
```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_DATABASE_URL=your_database_url
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

## 📈 Future Enhancements

### Ready for Implementation
- **Firebase Cloud Functions:** Advanced server-side validation with sentiment analysis
- **Typing Indicators:** Show when users are typing
- **Message Reactions:** Like/emoji reactions to messages
- **User Profiles:** Extended user information and avatars
- **Message Formatting:** Rich text, code blocks, links
- **Chat Rooms:** Multiple chat channels
- **File Sharing:** Image and file uploads

### Prepared Code
- Cloud Functions with profanity filtering, sentiment analysis, and spam detection
- Admin utilities for chat monitoring and moderation
- Comprehensive validation and error handling systems

## 🐛 Known Limitations

1. **Firebase Cloud Functions:** Requires Blaze (pay-as-you-go) plan for deployment
2. **GitHub Pages:** Uses HashRouter instead of BrowserRouter for compatibility
3. **Client-Side Validation:** More vulnerable than server-side validation
4. **Basic Profanity Filter:** Limited word list (easily expandable)

## 📊 Performance

- **Build Size:** ~500KB gzipped
- **First Load:** ~2-3 seconds
- **Real-time Updates:** Near-instantaneous via Firebase
- **Mobile Performance:** Optimized for mobile devices

## 🤝 Contributing

This is a practice project demonstrating modern React development with Firebase integration. Feel free to fork and enhance!

## 📄 License

MIT License - Feel free to use this code for learning and practice.
