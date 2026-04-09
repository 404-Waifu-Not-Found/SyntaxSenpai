module.exports = {
  activate({ registerTool }) {
    registerTool({
      definition: {
        name: 'echo_text',
        description: 'Echoes text back to the caller. Example plugin tool.',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'The text to echo back'
            }
          },
          required: ['text']
        }
      },
      requiresPermission: 'fileRead',
      async execute(input) {
        return {
          success: true,
          data: {
            echoed: input.text
          },
          displayText: String(input.text ?? '')
        }
      }
    })
  }
}
