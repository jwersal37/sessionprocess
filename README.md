# React Chat App with Firebase

A modern React TypeScript application with Firebase authentication and real-time chat functionality, built with Vite and styled with Tailwind CSS.

## Features

- **User Authentication**: Sign up, sign in, and sign out functionality
- **User Dashboard**: View and update profile information
- **Real-time Chatroom**: Chat with other users in real-time
- **Responsive Design**: Modern UI built with Tailwind CSS
- **GitHub Pages Ready**: Configured for easy deployment

## Tech Stack

- React 18 + TypeScript
- Firebase (Authentication & Realtime Database)
- React Router for navigation
- Tailwind CSS for styling
- Vite for development and building

## Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd sessionprocess
npm install
```

### 2. Firebase Configuration

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication (Email/Password provider)
3. Enable Realtime Database
4. Copy your Firebase config from Project Settings
5. Create a `.env` file in the root directory based on `.env.example`:

```env
VITE_FIREBASE_API_KEY=your-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=your-app-id
```

### 3. Firebase Security Rules

Set up the following security rules in your Firebase console:

**Authentication Rules** (already configured when you enable Email/Password)

**Realtime Database Rules**:
```json
{
  "rules": {
    "messages": {
      ".read": "auth != null",
      ".write": "auth != null",
      "$messageId": {
        ".validate": "newData.hasChildren(['text', 'user', 'timestamp'])"
      }
    }
  }
}
```

### 4. Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

### 5. Building for Production

```bash
npm run build
```

## GitHub Pages Deployment

This project is configured for automatic deployment to GitHub Pages:

1. Push your code to the `main` branch
2. The GitHub Actions workflow will automatically build and deploy
3. Your app will be available at `https://yourusername.github.io/sessionprocess/`

## Project Structure

```
src/
├── components/          # React components
│   ├── Login.tsx       # Login form
│   ├── Signup.tsx      # Registration form
│   ├── Dashboard.tsx   # User dashboard
│   ├── Chatroom.tsx    # Real-time chat
│   └── PrivateRoute.tsx # Route protection
├── contexts/           # React contexts
│   └── AuthContext.tsx # Authentication context
├── firebase.ts         # Firebase configuration
├── App.tsx            # Main app component
└── main.tsx           # App entry point
```

## Usage

1. **Sign Up**: Create a new account with email and password
2. **Dashboard**: View your profile and update your display name
3. **Chatroom**: Join the real-time chat to talk with other users
4. **Navigation**: Use the navigation links to move between sections

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the [MIT License](LICENSE).
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```
