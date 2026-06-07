FROM alpine:3.22
RUN apk add --no-cache net-snmp net-snmp-tools
COPY snmpd.conf /etc/snmp/snmpd.conf
EXPOSE 1161/udp
CMD ["snmpd", "-f", "-Lo", "-C", "-c", "/etc/snmp/snmpd.conf"]
