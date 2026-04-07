import React from 'react';
import WaifuList from './WaifuList';

const waifus = [
  {
    id: 'demo-1',
    displayName: 'Aiko',
    backstory: 'Cheerful coding assistant.',
    tags: ['friendly'],
    avatar: { expressions: { neutral: { uri: '/avatars/demo-1.png' } } },
    communicationStyle: { signatureEmojis: ['🎀'] }
  },
  {
    id: 'demo-2',
    displayName: 'Yumi',
    backstory: 'Calm and helpful.',
    tags: ['calm'],
    avatar: { expressions: { neutral: { uri: '/avatars/demo-2.png' } } },
    communicationStyle: { signatureEmojis: ['🌸'] }
  }
];

export default {
  title: 'Components/WaifuList',
  component: WaifuList
};

export const Grid = () => <WaifuList waifus={waifus} />;
