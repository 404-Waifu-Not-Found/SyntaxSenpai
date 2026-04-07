import React from 'react';

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  controls: { expanded: true }
};

export const decorators = [
  (Story) => (
    <div style={{ padding: 16, background: '#f6f7fb', minHeight: '100vh' }}>
      <Story />
    </div>
  )
];
