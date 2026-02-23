FROM debian:bookworm-slim

RUN apt update && apt upgrade -y \
	&& apt install -y curl git python3 python3-pip python3-requests \
	&& curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
	&& apt install -y nodejs \
	&& cd /opt \
	&& git clone https://github.com/ea5gvk/tetra-live-monitor.git \
	&& cd tetra-live-monitor \
	&& npm install \
	&& npm run build \
	&& apt autoremove -y

EXPOSE 5000

WORKDIR /opt/tetra-live-monitor
	
CMD NODE_ENV=production node dist/index.cjs
