REMOTE=root@95.216.192.49

release: build deploy

build:
	rsync -a --exclude src/node_modules ./src/ ./dist
	cd dist && NODE_ENV=production npm ci

deploy:
	ssh $(REMOTE) 'cd /root/app && make stop-node'
	rsync -avz --progress -e 'ssh' ./dist/ $(REMOTE):/root/app

remote:
	ssh $(REMOTE)

dev:
	cd src && make dev