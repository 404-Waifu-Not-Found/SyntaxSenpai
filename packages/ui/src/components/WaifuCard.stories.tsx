import React from 'react';
import WaifuCard from './WaifuCard';

const demoWaifu = {
  id: 'demo-1',
  displayName: 'Aiko',
  backstory: 'Cheerful coding assistant.',
  tags: ['friendly', 'helpful'],
  avatar: { expressions: { neutral: { uri: '/avatars/demo-1.png' } } },
  communicationStyle: { signatureEmojis: ['🎀'] }
};

export default {
  title: 'Components/WaifuCard',
  component: WaifuCard
};

export const Default = () => <WaifuCard waifu={demoWaifu} />;
