import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import ymlParser from 'yaml';

/* пример secrets.yml
---
NODE_ENV:
  environments:
    development: development
    test: test
    production: production
SECRET_TOKEN:
  environments:
    development: jopa lala
    test: null # это будет пропущено из-за пустого значения
    production: 2wGpqy0bTy-TSjAr5r79uA # это будет пропущено из-за секции secrets
  secrets:
    - production
...
*/

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envsFilters = [ // убирает переменные:
  (envName, varValue) => (varValue === null), // со значением null
  (envName, varValue, variableName, secrets) => secrets.includes(envName), // указанные в секции secrets
];

fs.readFile(path.join(__dirname, 'secrets.yml'), 'utf8')
  .then(ymlParser.parse)
  .then((rawEnnvsMap) => Object
    .entries(rawEnnvsMap)
    .reduce(
      (acc, [varName, varConfig]) => {
        const { environments, secrets = [] } = varConfig;

        Object.entries(environments).forEach(([envName, varValue]) => {
          const canBeExcluded = envsFilters.some((check) => check(envName, varValue, varValue, secrets));
          if (!canBeExcluded) {
            const currentEnvConfigLines = acc.has(envName) ? acc.get(envName) : [];
            currentEnvConfigLines.push(`${varName}=${varValue}`);
            acc.set(envName, currentEnvConfigLines);
          }
        });

        return acc;
      },
      new Map([]),
    ))
  .then((configLinesByEnv) => {
    const promises = [];
    configLinesByEnv.forEach((configLines, envName) => {
      let filename = '';
      switch (envName) {
        case 'production':
          filename = '.env';
          break;
        case 'test':
          filename = 'test.config';
          break;
        default:
          filename = `${envName}.env`;
          break;
      }
      const filepath = path.join(__dirname, filename);
      const promise = fs.writeFile(filepath, configLines.join('\n')).then(() => filepath);
      promises.push(promise);
      if (envName === 'development') {
        const filepathExample = path.join(__dirname, `${filename}.example`);
        const promiseExample = fs.writeFile(filepathExample, configLines.join('\n')).then(() => filepathExample);
        promises.push(promiseExample);
      }
    });
    return Promise.all(promises);
  })
  .then((createdFilesPaths) => {
    console.log('All done! Created files:', createdFilesPaths);
  });
