import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import ymlParser from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envsFilters = [
  (envName, varValue) => (!varValue), // переменные с пустым значением
  (envName, varValue, variableName, secrets) => secrets.includes(envName), // переменные, указанные в секции secrets
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
      const filename = `${envName}.env`;
      const filepath = path.join(__dirname, filename);
      const promise = fs.writeFile(filepath, configLines.join('\n')).then(() => filepath);
      promises.push(promise);
    });
    return Promise.all(promises);
  })
  .then((createdFilesPaths) => {
    console.log('All done! Created files:', createdFilesPaths);
  });
