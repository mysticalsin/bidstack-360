const fs = require('fs');
let content = fs.readFileSync('packages/db/prisma/schema.prisma', 'utf8');

const modelRegex = /model (\w+) \{([\s\S]*?)\n\}/g;
const modelsNeedingIndex = [];
let m;
while ((m = modelRegex.exec(content)) !== null) {
  const modelName = m[1];
  const block = m[2];
  if (block.includes('deletedAt') && !block.includes('@@index([deletedAt])')) {
    modelsNeedingIndex.push(modelName);
  }
}

for (const modelName of modelsNeedingIndex) {
  const regex = new RegExp('(model ' + modelName + ' \\{[\\s\\S]*?)(\\n\\})', 'g');
  content = content.replace(regex, (match, fields, ending) => {
    if (fields.includes('@@index([deletedAt])')) return match;
    const lines = fields.split('\n');
    lines.push('  @@index([deletedAt])');
    return lines.join('\n') + ending;
  });
}

fs.writeFileSync('packages/db/prisma/schema.prisma', content);
console.log('Added deletedAt index to', modelsNeedingIndex.length, 'models');
