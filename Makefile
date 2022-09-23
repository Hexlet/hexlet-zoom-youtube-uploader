build:
	rsync -a --exclude src/node_modules ./src/ ./dist
	cd dist && NODE_ENV=production npm ci

deploy:
	rsync -avz --progress -e 'ssh' ./dist/ root@95.216.192.49:/root/app

remote:
	ssh root@95.216.192.49
